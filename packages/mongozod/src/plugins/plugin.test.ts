import type { AnyModel, FilterOf, ReadOptionsArg } from '../index'

import { MongoClient } from 'mongodb'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  inject,
  test
} from 'vitest'
import { z } from 'zod'

import { mongozod } from '../mongozod'

import { definePlugin } from './plugin'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-plugins')

beforeAll(() => client.connect())
afterAll(() => client.close())
beforeEach(() => db.dropDatabase())

const noteSchema = z.object({
  _id: z.uuidv4().default(() => crypto.randomUUID()),
  createdBy: z.string().optional(),
  organization: z.string(),
  title: z.string(),
  updatedBy: z.string().optional()
})

/** Records what each plugin sees, in order. */
function tracer(id: string, calls: string[]) {
  return definePlugin({
    hooks: {
      find: {
        after: () => void calls.push(`${id} find after`),
        before: () => void calls.push(`${id} find before`)
      },
      read: {
        after: ({ operation }) => void calls.push(`${id} read after ${operation}`),
        before: ({ operation }) => void calls.push(`${id} read before ${operation}`)
      }
    },
    id,
    async middleware({ next, operation }) {
      calls.push(`${id} middleware ${operation}`)

      return next()
    }
  })
}

describe('hooks', () => {
  test('run in layers: group before operation on before, the other way around on after', async () => {
    const calls: string[] = []
    const NotesModel = mongozod({
      collection: 'notes',
      db,
      plugins: [tracer('a', calls), tracer('b', calls)],
      schema: noteSchema
    })

    await NotesModel.countDocuments({})

    expect(calls).toEqual([
      'a middleware countDocuments',
      'a read before countDocuments',
      'b middleware countDocuments',
      'b read before countDocuments',
      'b read after countDocuments',
      'a read after countDocuments'
    ])
  })

  test('change the arguments and the result', async () => {
    const NotesModel = mongozod({
      collection: 'notes',
      db,
      plugins: [
        definePlugin({
          hooks: {
            countDocuments: { after: ({ result }) => ({ result: result * 10 }) },
            read: {
              before: ({ args }) => ({
                args: { ...args, filter: { $and: [args.filter, { organization: 'o1' }] } }
              })
            }
          },
          id: 'scope'
        })
      ],
      schema: noteSchema
    })

    await NotesModel.insertMany([
      { organization: 'o1', title: 'One' },
      { organization: 'o2', title: 'Two' }
    ])

    expect(await NotesModel.countDocuments({})).toBe(10)
    expect(await NotesModel.find({}).toArray()).toEqual([
      expect.objectContaining({ organization: 'o1' })
    ])
  })

  test('a before that returns a result skips the next layers, but not the afters of its own', async () => {
    const calls: string[] = []
    const NotesModel = mongozod({
      collection: 'notes',
      db,
      plugins: [
        tracer('outer', calls),
        definePlugin({
          hooks: {
            findOne: {
              after: () => void calls.push('cache after'),
              before: () => ({ result: { _id: 'cached', organization: 'o', title: 'Cached' } })
            }
          },
          id: 'cache'
        }),
        tracer('inner', calls)
      ],
      schema: noteSchema
    })

    expect(await NotesModel.findOne({})).toEqual({
      _id: 'cached',
      organization: 'o',
      title: 'Cached'
    })
    expect(calls).toEqual([
      'outer middleware findOne',
      'outer read before findOne',
      'cache after',
      'outer read after findOne'
    ])
  })

  test('the model they receive goes through every plugin again', async () => {
    const NotesModel = mongozod({
      collection: 'notes',
      db,
      plugins: [
        definePlugin({
          hooks: {
            deleteOne: {
              async before({ args, model }) {
                const result = await model.updateOne(args.filter, { $set: { title: 'deleted' } })

                return { result: { acknowledged: true, deletedCount: result.modifiedCount } }
              }
            },
            update: { before: ({ args }) => ({ args: { ...args, filter: { title: 'One' } } }) }
          },
          id: 'rename'
        })
      ],
      schema: noteSchema
    })

    await NotesModel.insertMany([
      { organization: 'o', title: 'One' },
      { organization: 'o', title: 'Two' }
    ])

    expect(await NotesModel.deleteOne({ title: 'Two' })).toEqual({
      acknowledged: true,
      deletedCount: 1
    })
    expect(await NotesModel.find().sort({ title: 1 }).project({ _id: 0, title: 1 })).toEqual([
      { title: 'Two' },
      { title: 'deleted' }
    ])
  })

  test('aggregate and estimatedDocumentCount have no group, only their own hooks', async () => {
    const calls: string[] = []
    const NotesModel = mongozod({
      collection: 'notes',
      db,
      plugins: [
        tracer('a', calls),
        definePlugin({
          hooks: { aggregate: { before: () => void calls.push('aggregate before') } },
          id: 'own'
        })
      ],
      schema: noteSchema
    })

    await NotesModel.aggregate([])
    await NotesModel.estimatedDocumentCount()

    expect(calls).toEqual([
      'aggregate before',
      'a middleware aggregate',
      'a middleware estimatedDocumentCount'
    ])
  })
})

describe('cursors', () => {
  test('run the befores once and the middleware and afters once per batch', async () => {
    const calls: string[] = []
    const NotesModel = mongozod({
      collection: 'notes',
      db,
      plugins: [tracer('a', calls)],
      schema: noteSchema
    })

    await NotesModel.insertMany([
      { organization: 'o', title: 'One' },
      { organization: 'o', title: 'Two' }
    ])

    const titles: string[] = []

    for await (const note of NotesModel.find({}, { batchSize: 1 })) titles.push(note.title)

    expect(titles).toHaveLength(2)
    expect(calls.filter((call) => call.includes('before'))).toEqual([
      'a read before find',
      'a find before'
    ])
    expect(calls.filter((call) => call === 'a middleware find').length).toBeGreaterThanOrEqual(2)
  })

  test('the befores see the modifiers of the cursor, which cannot change once it starts', async () => {
    let seen: unknown
    const NotesModel = mongozod({
      collection: 'notes',
      db,
      plugins: [
        definePlugin({
          hooks: { find: { before: ({ args }) => void (seen = args.options) } },
          id: 'spy'
        })
      ],
      schema: noteSchema
    })
    const cursor = NotesModel.find().sort({ title: 1 }).limit(2)

    await cursor.toArray()

    expect(seen).toEqual({ limit: 2, sort: { title: 1 } })
    expect(() => cursor.skip(1)).toThrow('the cursor already started')
  })
})

describe('the fields a plugin fills', () => {
  const tenantContext = z.object({ tenantId: z.string() })
  const tenant = definePlugin({
    context: { insert: tenantContext, update: tenantContext },
    fields: { tenantId: z.string() },
    fills: ['tenantId'],
    hooks: {
      insertOne: {
        before: ({ args, context }) => ({
          args: { ...args, document: { ...args.document, tenantId: context.tenantId } }
        })
      },
      replaceOne: {
        before: ({ args, context }) => ({
          args: { ...args, replacement: { ...args.replacement, tenantId: context.tenantId } }
        })
      }
    },
    id: 'tenant'
  })
  const projectSchema = z.object({ _id: z.string(), tenantId: z.string(), title: z.string() })

  test('are optional in inserts and replacements, as the fields of timestamps', async () => {
    const ProjectsModel = mongozod({
      collection: 'projects',
      db,
      plugins: [tenant],
      schema: projectSchema
    })
    const context = { tenantId: 't1' }

    await ProjectsModel.insertOne({ _id: 'p1', title: 'One' }, { context })
    await ProjectsModel.replaceOne({ _id: 'p1' }, { _id: 'p1', title: 'Two' }, { context })

    expect(await ProjectsModel.findOne({ _id: 'p1' })).toEqual({
      _id: 'p1',
      tenantId: 't1',
      title: 'Two'
    })
  })

  test('are still validated, and are fields of the plugin', async () => {
    const forgetful = definePlugin({
      fields: { tenantId: z.string() },
      fills: ['tenantId'],
      id: 'x'
    })
    const ForgottenModel = mongozod({
      collection: 'projects',
      db,
      plugins: [forgetful],
      schema: projectSchema
    })

    await expect(ForgottenModel.insertOne({ _id: 'p1', title: 'One' })).rejects.toMatchObject({
      issues: [{ path: ['tenantId'] }]
    })
    expect(() =>
      mongozod({
        collection: 'projects',
        db,
        plugins: [
          // @ts-expect-error title is not a field of the plugin
          definePlugin({ fields: { tenantId: z.string() }, fills: ['title'], id: 'y' })
        ],
        schema: projectSchema
      })
    ).toThrow('y fills "title", which is not one of its fields')
  })
})

describe('context and options', () => {
  const actor = z.object({ actor: z.string().min(1) })
  const audit = definePlugin({
    context: { insert: actor, update: actor },
    hooks: {
      insertOne: {
        before: ({ args, context }) => ({
          args: { ...args, document: { ...args.document, createdBy: context.actor } }
        })
      },
      update: {
        before({ args, context }) {
          if (!('update' in args)) return undefined

          // A pipeline, which `updatePipeline: true` allows, takes one more `$set` stage.
          const update = Array.isArray(args.update)
            ? [...args.update, { $set: { updatedBy: context.actor } }]
            : { ...args.update, $set: { ...args.update.$set, updatedBy: context.actor } }

          return { args: { ...args, update } }
        }
      }
    },
    id: 'audit'
  })
  const AuditedModel = mongozod({ collection: 'notes', db, plugins: [audit], schema: noteSchema })

  test('a plugin gets its own context, which the writes of its groups require', async () => {
    const { document } = await AuditedModel.insertOne(
      { organization: 'o', title: 'One' },
      { context: { actor: 'ana' } }
    )

    await AuditedModel.updateOne(
      { _id: document._id },
      { $set: { title: 'Two' } },
      { context: { actor: 'luis' } }
    )

    expect(await AuditedModel.findOne({ _id: document._id })).toMatchObject({
      createdBy: 'ana',
      updatedBy: 'luis'
    })
    // Reads need no context: no plugin declares one for them.
    expect(await AuditedModel.countDocuments({})).toBe(1)
  })

  test('the context is validated, and does not reach the driver', async () => {
    await expect(
      // @ts-expect-error the writes of this model need a context
      AuditedModel.insertOne({ organization: 'o', title: 'One' })
    ).rejects.toMatchObject({ issues: [{ path: ['context'] }] })
    await expect(
      AuditedModel.insertOne({ organization: 'o', title: 'One' }, { context: { actor: '' } })
    ).rejects.toMatchObject({ issues: [{ path: ['context', 'actor'] }] })
  })

  test('a plugin option is validated, given parsed to the hooks and left out of the driver', async () => {
    let seen: unknown
    const LimitedModel = mongozod({
      collection: 'notes',
      db,
      plugins: [
        definePlugin({
          hooks: {
            find: {
              before({ args }) {
                seen = args.options.maxDocuments

                return {
                  args: { ...args, options: { ...args.options, limit: args.options.maxDocuments } }
                }
              }
            }
          },
          id: 'limit',
          options: { read: z.object({ maxDocuments: z.coerce.number().int().default(1) }) }
        })
      ],
      schema: noteSchema
    })

    await LimitedModel.insertMany([
      { organization: 'o', title: 'One' },
      { organization: 'o', title: 'Two' }
    ])

    expect(await LimitedModel.find({}, { maxDocuments: 2 })).toHaveLength(2)
    expect(seen).toBe(2)
    expect(await LimitedModel.find({})).toHaveLength(1)
    // @ts-expect-error the option belongs to the reads
    await LimitedModel.deleteMany({}, { maxDocuments: 1 })
  })
})

describe('methods', () => {
  const exists = definePlugin({
    id: 'exists',
    methods: {
      /** True when at least one document matches. */
      async exists<M extends AnyModel, const F extends FilterOf<M, F>>(
        this: M,
        filter: F,
        ...options: ReadOptionsArg<M>
      ) {
        return (await this.countDocuments(filter, { ...options[0], limit: 1 })) > 0
      }
    }
  })

  test('are added to the model, typed by it', async () => {
    const NotesModel = mongozod({ collection: 'notes', db, plugins: [exists], schema: noteSchema })

    await NotesModel.insertOne({ organization: 'o', title: 'One' })

    expect(await NotesModel.exists({ title: 'One' })).toBe(true)
    expect(await NotesModel.exists({ title: 'Two' })).toBe(false)
    // @ts-expect-error a title is a string
    await NotesModel.exists({ title: 1 })
  })

  test('cannot repeat across plugins, nor shadow a member of the model', () => {
    expect(() =>
      // @ts-expect-error two plugins define "exists"
      mongozod({ collection: 'notes', db, plugins: [exists, exists], schema: noteSchema })
    ).toThrow('two plugins define "exists"')
    expect(() =>
      // @ts-expect-error find is a member of the model
      mongozod({
        collection: 'notes',
        db,
        plugins: [definePlugin({ id: 'shadow', methods: { find: () => [] } })],
        schema: noteSchema
      })
    ).toThrow('shadow: "find" is a member of the model')
  })
})

describe('the option', () => {
  test('needs the fields of each plugin in the schema, with a compatible type', () => {
    const stamped = definePlugin({ fields: { deletedAt: z.date().optional() }, id: 'stamped' })

    expect(() =>
      // @ts-expect-error the schema has no deletedAt
      mongozod({ collection: 'notes', db, plugins: [stamped], schema: noteSchema })
    ).toThrow('stamped needs the field "deletedAt" in the schema')
    expectTypeOf(() =>
      // @ts-expect-error deletedAt is a string
      mongozod({
        collection: 'notes',
        db,
        plugins: [stamped],
        schema: noteSchema.extend({ deletedAt: z.string().optional() })
      })
    ).toBeFunction()
  })

  test('takes no plugin option that shadows one of mongozod or of another plugin', () => {
    const one = definePlugin({ id: 'one', options: { read: z.object({ verbose: z.boolean() }) } })
    const two = definePlugin({ id: 'two', options: { update: z.object({ verbose: z.boolean() }) } })

    const plain = definePlugin({ id: 'plain' })

    expect(() =>
      // @ts-expect-error two: "verbose" is an option of another plugin
      mongozod({ collection: 'notes', db, plugins: [one, two], schema: noteSchema })
    ).toThrow('two: "verbose" is an option of one')
    // A plugin without options leaves every name to the others.
    expect(() =>
      mongozod({ collection: 'notes', db, plugins: [plain, one], schema: noteSchema })
    ).not.toThrow()
    expect(() =>
      // @ts-expect-error populate is an option of mongozod
      mongozod({
        collection: 'notes',
        db,
        plugins: [
          definePlugin({ id: 'own', options: { read: z.object({ populate: z.boolean() }) } })
        ],
        schema: noteSchema
      })
    ).toThrow('own: "populate" is an option of mongozod')
    expectTypeOf(() =>
      // @ts-expect-error session is an option of the driver
      mongozod({
        collection: 'notes',
        db,
        plugins: [
          definePlugin({ id: 'driver', options: { read: z.object({ session: z.string() }) } })
        ],
        schema: noteSchema
      })
    ).toBeFunction()
  })
})
