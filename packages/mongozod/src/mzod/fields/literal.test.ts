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

import { toJsonSchema } from '../../model/json-schema'
import { mongozod } from '../../mongozod'
import { isLiteral } from '../../schema/schema-kinds'
import { filter } from '../filter'
import { update } from '../update'

import { literal } from './literal'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-fields-literal')

beforeAll(() => client.connect())
afterAll(() => client.close())
beforeEach(() => db.dropDatabase())

const componentSchema = z.object({
  _id: z.string(),
  blocks: z.array(literal(z.json())).default([]),
  props: literal(z.json()),
  repeat: literal(
    z.object({ statePath: z.union([z.string(), z.object({ $item: z.string() })]) })
  ).optional(),
  settings: z.record(z.string(), z.json()).default({})
})

const ComponentsModel = mongozod({ collection: 'components', db, schema: componentSchema })

const toolSchema = z.object({ _id: z.string(), inputSchema: literal(z.json()) })

const ToolsModel = mongozod({ collection: 'tools', db, schema: toolSchema })

const spec = {
  title: { $state: '/title' },
  visible: { $cond: { $state: '/show' }, $then: true, $else: false }
}

const jsonSchema = z
  .json()
  .parse(
    z.toJSONSchema(
      z.object({ 'a.b': z.string(), 'node': z.object({ name: z.string() }).meta({ id: 'Node' }) })
    )
  )

/** The issue of a key that a model rejects outside a field of `mz.literal()`. */
function message(key: string) {
  return `"${key}" cannot be a key: no path reaches a key with a "." or starting with "$": mz.literal() stores the keys of a field as data`
}

/** The issues a write fails with, each as its path and its message. */
async function issuesOf(write: () => Promise<unknown>) {
  try {
    await write()
  } catch (error) {
    if (error instanceof z.ZodError) {
      return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    }

    throw error
  }

  return []
}

describe('literal()', () => {
  test('returns the same schema, typed the same, and the model knows it', () => {
    const schema = literal(z.json())

    expectTypeOf(schema).toEqualTypeOf<z.ZodJSONSchema>()
    expect(isLiteral(schema)).toBe(true)
    expect(isLiteral(schema.optional())).toBe(true)
    expect(isLiteral(z.json())).toBe(false)
  })

  test('takes keys with a "." or starting with "$" in a model, declared or dynamic', () => {
    expect(() =>
      mongozod({
        collection: 'repeats',
        db,
        schema: z.object({ repeat: z.object({ statePath: z.object({ $item: z.string() }) }) })
      })
    ).toThrow(
      '"$item" in "repeat.statePath" is not a valid field name: no path can reach a field with a "." or starting with "$": mz.literal() stores the keys of a field as data'
    )
  })

  test('rejects an object that reads back as a DBRef, at any level', () => {
    const schema = literal(z.json())

    expect(
      schema.safeParse({ a: [{ $ref: '#', $id: 'x', type: 'object' }] }).error?.issues
    ).toEqual([
      expect.objectContaining({
        message:
          'an object whose keys that start with "$" are only "$ref", "$id" and "$db" reads back as a DBRef: add another key that starts with "$", or rename them',
        path: ['a', 0]
      })
    ])

    for (const value of [
      { $ref: '#/$defs/Node' },
      { $id: 'x', $ref: '#', $schema: 'https://json-schema.org/draft/2020-12/schema' },
      { $id: null, $ref: '#' }
    ]) {
      expect(schema.safeParse(value).success).toBe(true)
    }
  })
})

describe('a write', () => {
  test('stores the keys of the field as data, and reads them back as written', async () => {
    await ComponentsModel.insertOne({
      _id: 'a',
      props: spec,
      repeat: { statePath: { $item: 'title' } }
    })
    await ComponentsModel.insertMany([{ _id: 'b', props: { label: { $t: 'key' } } }])
    await ToolsModel.insertOne({ _id: 'search', inputSchema: jsonSchema })

    expect(await ComponentsModel.findOne({ _id: 'a' })).toEqual({
      _id: 'a',
      blocks: [],
      props: spec,
      repeat: { statePath: { $item: 'title' } },
      settings: {}
    })
    expect(await ComponentsModel.findOne({ _id: 'b' })).toMatchObject({
      props: { label: { $t: 'key' } }
    })
    expect(await ToolsModel.findOne({ _id: 'search' })).toEqual({
      _id: 'search',
      inputSchema: jsonSchema
    })
  })

  test('replaces a document with them, alone or in a bulk write', async () => {
    await ComponentsModel.insertOne({ _id: 'a', props: {} })
    await ComponentsModel.replaceOne({ _id: 'a' }, { _id: 'a', props: { a: { $index: true } } })

    expect(
      await ComponentsModel.findOneAndReplace(
        { _id: 'a' },
        { _id: 'a', props: { b: { $bindState: '/form/email' } } },
        { returnDocument: 'after' }
      )
    ).toMatchObject({ props: { b: { $bindState: '/form/email' } } })

    await ComponentsModel.bulkWrite([
      { insertOne: { document: { _id: 'b', props: { $computed: 'fn', args: {} } } } },
      { replaceOne: { filter: { _id: 'a' }, replacement: { _id: 'a', props: { $t: 'x' } } } },
      { updateOne: { filter: { _id: 'b' }, update: { $set: { props: { $t: 'y' } } } } }
    ])

    expect(await ComponentsModel.find({}, { sort: { _id: 1 } })).toMatchObject([
      { props: { $t: 'x' } },
      { props: { $t: 'y' } }
    ])
  })

  test('sets the field, or a path inside it, with $set and $setOnInsert', async () => {
    await ComponentsModel.insertOne({ _id: 'a', props: {} })
    await ComponentsModel.updateOne({ _id: 'a' }, { $set: { props: spec } })
    await ComponentsModel.updateOne({ _id: 'a' }, { $set: { 'props.title': { $state: '/t' } } })
    await ComponentsModel.updateOne(
      { _id: 'b' },
      { $setOnInsert: { props: { $template: 'Hi ${/user/name}' } } },
      { upsert: true }
    )

    expect(await ComponentsModel.findOne({ _id: 'a' })).toMatchObject({
      props: { ...spec, title: { $state: '/t' } }
    })
    expect(await ComponentsModel.findOne({ _id: 'b' })).toMatchObject({
      props: { $template: 'Hi ${/user/name}' }
    })
  })

  test('adds elements with $push and $addToSet, whose keys are modifiers only with $each', async () => {
    await ComponentsModel.insertOne({ _id: 'a', props: {} })
    await ComponentsModel.updateOne({ _id: 'a' }, { $push: { blocks: { $state: '/a' } } })
    await ComponentsModel.updateOne(
      { _id: 'a' },
      { $push: { blocks: { $each: [{ $slice: 1 }], $position: 0 } } }
    )
    await ComponentsModel.updateOne({ _id: 'a' }, { $addToSet: { blocks: { 'a.b': 1 } } })

    expect(await ComponentsModel.findOne({ _id: 'a' })).toMatchObject({
      blocks: [{ $slice: 1 }, { $state: '/a' }, { 'a.b': 1 }]
    })
  })

  test('rejects these keys outside the field, pointing at mz.literal()', async () => {
    expect(
      await issuesOf(() =>
        ComponentsModel.insertOne({ _id: 'a', props: {}, settings: { a: { $state: '/a' } } })
      )
    ).toEqual([`settings.a.$state: ${message('$state')}`])
    expect(
      await issuesOf(() =>
        ComponentsModel.updateOne({ _id: 'a' }, { $set: { settings: { 'a.b': 1 } } })
      )
    ).toEqual([`$set.settings.a.b: ${message('a.b')}`])
  })

  test('rejects an object that reads back as a DBRef', async () => {
    expect(
      await issuesOf(() =>
        ToolsModel.insertOne({ _id: 'a', inputSchema: { items: { $id: 'x', $ref: '#' } } })
      )
    ).toEqual([
      'inputSchema.items: an object whose keys that start with "$" are only "$ref", "$id" and "$db" reads back as a DBRef: add another key that starts with "$", or rename them'
    ])
  })

  test('reaches no key of the field that starts with "$"', async () => {
    expect(
      await issuesOf(() =>
        // @ts-expect-error "repeat.statePath.$item" is not a path
        ComponentsModel.updateOne({ _id: 'a' }, { $set: { 'repeat.statePath.$item': 'x' } })
      )
    ).toHaveLength(1)

    // @ts-expect-error "repeat.statePath.$item" is not a path
    await ComponentsModel.findOne({ 'repeat.statePath.$item': 'x' })
  })
})

describe('the endpoint inputs', () => {
  test('still reject these keys in what a client sends', () => {
    const componentsUpdate = update(componentSchema, { $set: ['props'] })
    const componentsFilter = filter(componentSchema, { props: ['$eq'] })

    expect(componentsUpdate.safeParse({ $set: { props: { $state: '/a' } } }).success).toBe(false)
    expect(componentsFilter.safeParse({ props: { $ne: null } }).success).toBe(false)
  })
})

describe('the $jsonSchema of sync()', () => {
  test('rules the keys that start with "$" and leaves out the ones with a "."', async () => {
    const schema = z.object({
      repeat: literal(z.object({ '$item': z.string(), 'a.b': z.number() }))
    })

    expect(toJsonSchema(schema).properties.repeat).toEqual({
      bsonType: 'object',
      properties: { $item: { bsonType: 'string' } },
      required: ['$item']
    })

    await db.createCollection('repeats', { validator: { $jsonSchema: toJsonSchema(schema) } })

    const repeats = db.collection('repeats')

    await repeats.insertOne({ repeat: { '$item': 'title', 'a.b': 1 } })
    await expect(repeats.insertOne({ repeat: { '$item': 1, 'a.b': 1 } })).rejects.toThrow(
      'Document failed validation'
    )
  })
})
