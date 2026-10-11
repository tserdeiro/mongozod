import { MongoClient, MongoServerError } from 'mongodb'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from 'vitest'
import { z } from 'zod'

import { mongozod } from '../mongozod'
import { definePlugin } from '../plugin'

import { softDelete } from './soft-delete'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-soft-delete')

beforeAll(() => client.connect())
afterAll(() => client.close())
beforeEach(() => db.dropDatabase())

const dateSchema = z.union([
  z.date(),
  z.codec(z.iso.datetime(), z.date(), {
    decode: (iso) => new Date(iso),
    encode: (date) => date.toISOString()
  })
])

const noteSchema = z.object({
  _id: z.string(),
  createdAt: dateSchema.default(() => new Date()),
  deletedAt: dateSchema.optional(),
  organization: z.string(),
  title: z.string(),
  updatedAt: dateSchema.default(() => new Date())
})

const NotesModel = mongozod({
  collection: 'notes',
  db,
  plugins: [softDelete()],
  schema: noteSchema,
  timestamps: true
})

const TRASH = { deletedAt: { $exists: true } }

async function seed() {
  await NotesModel.insertMany([
    { _id: 'n1', organization: 'o', title: 'One' },
    { _id: 'n2', organization: 'o', title: 'Two' },
    { _id: 'n3', deletedAt: new Date(0), organization: 'o', title: 'Gone' }
  ])
}

describe('reads', () => {
  test('skip the deleted documents, unless the filter mentions deletedAt', async () => {
    await seed()

    expect(await NotesModel.find({ organization: 'o' }).sort({ _id: 1 })).toMatchObject([
      { _id: 'n1' },
      { _id: 'n2' }
    ])
    expect(await NotesModel.findOne({ _id: 'n3' })).toBeNull()
    expect(await NotesModel.countDocuments({})).toBe(2)
    expect(await NotesModel.distinct('title')).toEqual(['One', 'Two'])
    expect(await NotesModel.find({ organization: 'o', ...TRASH })).toMatchObject([{ _id: 'n3' }])
    expect(
      await NotesModel.countDocuments({
        $or: [{ deletedAt: { $exists: true } }, { deletedAt: { $exists: false } }]
      })
    ).toBe(3)
  })

  test('find the mention inside $and, as the routers wrap their filters', async () => {
    await seed()

    expect(await NotesModel.find({ $and: [{ organization: 'o' }, TRASH] })).toMatchObject([
      { _id: 'n3' }
    ])
  })

  test('leave aggregate and estimatedDocumentCount alone', async () => {
    await seed()

    expect(await NotesModel.aggregate([{ $match: { organization: 'o' } }])).toHaveLength(3)
    expect(await NotesModel.estimatedDocumentCount()).toBe(3)
  })
})

describe('deletes', () => {
  test('mark deletedAt with an update, which stamps updatedAt, and do not mark twice', async () => {
    await seed()

    const before = await NotesModel.findOne({ _id: 'n1' })

    expect(await NotesModel.deleteOne({ _id: 'n1' })).toEqual({
      acknowledged: true,
      deletedCount: 1
    })
    expect(await NotesModel.deleteOne({ _id: 'n1' })).toEqual({
      acknowledged: true,
      deletedCount: 0
    })
    expect(await NotesModel.deleteMany({})).toEqual({ acknowledged: true, deletedCount: 1 })

    const deleted = await NotesModel.findOne({ _id: 'n1', ...TRASH })

    expect(deleted?.deletedAt).toBeInstanceOf(Date)
    expect(deleted?.updatedAt.getTime()).toBeGreaterThan(before?.updatedAt.getTime() ?? 0)
    expect(await db.collection('notes').countDocuments()).toBe(3)
  })

  test('remove for real when the filter mentions deletedAt, which empties the trash', async () => {
    await seed()

    await NotesModel.deleteOne({ _id: 'n1', deletedAt: { $exists: false } })
    await NotesModel.deleteMany({ deletedAt: { $lt: new Date() } })

    expect(await db.collection('notes').find().toArray()).toMatchObject([{ _id: 'n2' }])
  })

  test('findOneAndDelete returns the document as it was before the mark', async () => {
    await seed()

    const note = await NotesModel.findOneAndDelete({ _id: 'n1' })

    expect(note).toMatchObject({ _id: 'n1', title: 'One' })
    expect(note).not.toHaveProperty('deletedAt')
    expect(await NotesModel.findOne({ _id: 'n1' })).toBeNull()
  })
})

describe('updates', () => {
  test('skip the deleted documents, and restore one when the filter mentions deletedAt', async () => {
    await seed()

    expect(await NotesModel.updateOne({ _id: 'n3' }, { $set: { title: 'x' } })).toMatchObject({
      matchedCount: 0
    })

    await NotesModel.updateOne({ _id: 'n3', ...TRASH }, { $unset: { deletedAt: '' } })

    expect(await NotesModel.findOne({ _id: 'n3' })).toMatchObject({ title: 'Gone' })
  })

  test('an upsert on the _id of a deleted document fails, instead of restoring it', async () => {
    await seed()

    await expect(
      NotesModel.updateOne(
        { _id: 'n3' },
        { $set: { title: 'Back' }, $setOnInsert: { organization: 'o' } },
        { upsert: true }
      )
    ).rejects.toBeInstanceOf(MongoServerError)
  })

  test('a bulkWrite follows the same rules, and counts what the driver reports', async () => {
    await seed()

    const result = await NotesModel.bulkWrite([
      { deleteOne: { filter: { _id: 'n1' } } },
      { updateOne: { filter: { _id: 'n3' }, update: { $set: { title: 'x' } } } },
      { deleteOne: { filter: { _id: 'n3', ...TRASH } } }
    ])

    expect(result).toMatchObject({ deletedCount: 1, matchedCount: 1, modifiedCount: 1 })
    expect(await NotesModel.find().project({ _id: 1 })).toEqual([{ _id: 'n2' }])
    expect(await db.collection('notes').countDocuments()).toBe(2)
  })
})

describe('with the rest of the model', () => {
  test('a unique index with deletedAt: null frees the key of a deleted document', async () => {
    const SlugsModel = mongozod({
      collection: 'slugs',
      db,
      indexes: (index) => [
        index({ title: 1 }, { partialFilterExpression: { deletedAt: null }, unique: true })
      ],
      plugins: [softDelete()],
      schema: noteSchema
    })

    await SlugsModel.sync()
    await SlugsModel.insertOne({ _id: 's1', organization: 'o', title: 'home' })
    await SlugsModel.deleteOne({ _id: 's1' })
    await SlugsModel.insertOne({ _id: 's2', organization: 'o', title: 'home' })

    await expect(
      SlugsModel.insertOne({ _id: 's3', organization: 'o', title: 'home' })
    ).rejects.toThrow('duplicate key')
  })

  test('populate leaves null for a referenced document that was deleted', async () => {
    const LinksModel = mongozod({
      collection: 'links',
      db,
      references: { note: () => NotesModel },
      schema: z.object({ _id: z.string(), note: z.string() })
    })

    await seed()
    await LinksModel.insertMany([
      { _id: 'l1', note: 'n1' },
      { _id: 'l3', note: 'n3' }
    ])

    expect(
      await LinksModel.find({}, { populate: { note: { title: 1 } } }).sort({ _id: 1 })
    ).toEqual([
      { _id: 'l1', note: { _id: 'n1', title: 'One' } },
      { _id: 'l3', note: null }
    ])
  })

  test('the update that marks a delete carries the context of the call', async () => {
    const actor = z.object({ actor: z.string() })
    const AuditedModel = mongozod({
      collection: 'audited',
      db,
      plugins: [
        softDelete(),
        definePlugin({
          context: { delete: actor, insert: actor, update: actor },
          hooks: {
            updateOne: {
              before: ({ args, context }) =>
                Array.isArray(args.update)
                  ? undefined
                  : {
                      args: {
                        ...args,
                        update: {
                          ...args.update,
                          $set: { ...args.update.$set, title: context.actor }
                        }
                      }
                    }
            }
          },
          id: 'audit'
        })
      ],
      schema: noteSchema
    })

    await AuditedModel.insertOne(
      { _id: 'a1', organization: 'o', title: 'One' },
      { context: { actor: 'ana' } }
    )
    await AuditedModel.deleteOne({ _id: 'a1' }, { context: { actor: 'luis' } })

    expect(await db.collection<{ _id: string }>('audited').findOne({ _id: 'a1' })).toMatchObject({
      title: 'luis'
    })
  })

  test('needs deletedAt in the schema', () => {
    expect(() =>
      // @ts-expect-error the schema has no deletedAt
      mongozod({
        collection: 'plain',
        db,
        plugins: [softDelete()],
        schema: z.object({ _id: z.string() })
      })
    ).toThrow('softDelete needs the field "deletedAt" in the schema')
  })
})
