import type { Db, WithId } from 'mongodb'

import { MongoClient, ObjectId } from 'mongodb'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  inject,
  test,
  vi
} from 'vitest'
import { z } from 'zod'
import * as zm from 'zod/mini'

import { mongozod } from './mongozod'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod')

beforeAll(() => client.connect())
afterAll(() => client.close())
beforeEach(() => db.dropDatabase())

const noteSchema = z.object({
  _id: z.uuidv4().default(() => crypto.randomUUID()),
  author: z
    .object({
      name: z.string(),
      nickname: z.string().optional()
    })
    .optional(),
  createdAt: z
    .union([z.date(), z.iso.datetime().transform((value) => new Date(value))])
    .default(() => new Date()),
  summary: z.string().optional(),
  tags: z.array(z.string()).default([]),
  title: z.string().min(1)
})

const NotesModel = mongozod({ collection: 'notes', db, schema: noteSchema })

describe('insertOne', () => {
  test('stores the output of the schema and returns it', async () => {
    const { document, insertedId } = await NotesModel.insertOne({
      createdAt: '2026-10-10T12:00:00Z',
      title: 'Groceries'
    })

    expect(document).toEqual({
      _id: insertedId,
      createdAt: new Date('2026-10-10T12:00:00Z'),
      tags: [],
      title: 'Groceries'
    })
    expect(await NotesModel.collection.findOne({ _id: insertedId })).toEqual(document)
    expectTypeOf(document).toEqualTypeOf<WithId<z.output<typeof noteSchema>>>()
  })

  test('throws a ZodError and writes nothing when the document is invalid', async () => {
    await expect(NotesModel.insertOne({ title: '' })).rejects.toBeInstanceOf(z.ZodError)
    expect(await NotesModel.countDocuments()).toBe(0)
  })

  test('does not write undefined keys, at any level', async () => {
    const { insertedId } = await NotesModel.insertOne({
      author: { name: 'Ana', nickname: undefined },
      summary: undefined,
      title: 'Groceries'
    })
    const stored = await NotesModel.collection.findOne({ _id: insertedId })

    expect(stored).not.toHaveProperty('summary')
    expect(stored?.author).toEqual({ name: 'Ana' })
  })

  test('lets the driver generate an ObjectId when the schema has no _id', async () => {
    const EventsModel = mongozod({
      collection: 'events',
      db,
      schema: z.object({ name: z.string() })
    })
    const { document, insertedId } = await EventsModel.insertOne({ name: 'signup' })

    expect(insertedId).toBeInstanceOf(ObjectId)
    expect(document).toEqual({ _id: insertedId, name: 'signup' })
    expectTypeOf(document._id).toEqualTypeOf<ObjectId>()
  })

  test('takes the input of the schema', () => {
    expectTypeOf(NotesModel)
      .toHaveProperty('insertOne')
      .parameter(0)
      .toEqualTypeOf<z.input<typeof noteSchema>>()

    // @ts-expect-error: "title" is required
    void NotesModel.insertOne({ tags: [] }).catch(() => undefined)
  })
})

describe('insertMany', () => {
  test('returns each stored document with its _id, in order', async () => {
    const { documents, insertedCount } = await NotesModel.insertMany([
      { title: 'One' },
      { title: 'Two' }
    ])

    expect(insertedCount).toBe(2)
    expect(await NotesModel.find().sort({ title: 1 })).toEqual(documents)
  })

  test('writes nothing when one document is invalid', async () => {
    await expect(NotesModel.insertMany([{ title: 'One' }, { title: '' }])).rejects.toBeInstanceOf(
      z.ZodError
    )
    expect(await NotesModel.countDocuments()).toBe(0)
  })
})

describe('replaceOne', () => {
  test('validates the replacement like an insert and keeps the _id', async () => {
    const { insertedId } = await NotesModel.insertOne({ summary: 'Milk', title: 'Groceries' })

    await NotesModel.replaceOne({ _id: insertedId }, { title: 'Errands' })

    expect(await NotesModel.findOne({ _id: insertedId })).toEqual({
      _id: insertedId,
      createdAt: expect.any(Date),
      tags: [],
      title: 'Errands'
    })
    await expect(NotesModel.replaceOne({ _id: insertedId }, { title: '' })).rejects.toBeInstanceOf(
      z.ZodError
    )
  })

  test('writes the _id when it is given, so the server checks it', async () => {
    const { insertedId } = await NotesModel.insertOne({ title: 'Groceries' })

    await NotesModel.replaceOne({ _id: insertedId }, { _id: insertedId, title: 'Errands' })

    await expect(
      NotesModel.replaceOne({ _id: insertedId }, { _id: crypto.randomUUID(), title: 'Errands' })
    ).rejects.toMatchObject({ code: 66 })
  })

  test('findOneAndReplace validates the replacement the same way', async () => {
    const { insertedId } = await NotesModel.insertOne({ title: 'Groceries' })
    const replaced = await NotesModel.findOneAndReplace(
      { _id: insertedId },
      { title: 'Errands' },
      { returnDocument: 'after' }
    )

    expect(replaced).toMatchObject({ _id: insertedId, tags: [], title: 'Errands' })
  })
})

describe('bulkWrite', () => {
  test('validates inserts and replacements, and passes the rest to the driver', async () => {
    const { insertedId } = await NotesModel.insertOne({ title: 'Groceries' })
    const result = await NotesModel.bulkWrite([
      { insertOne: { document: { title: 'Errands' } } },
      { replaceOne: { filter: { _id: insertedId }, replacement: { title: 'Shopping' } } },
      { deleteMany: { filter: { title: 'Nothing' } } }
    ])

    expect(result).toMatchObject({ insertedCount: 1, modifiedCount: 1 })
    expect(
      await NotesModel.find().sort({ title: 1 }).project({ _id: 0, tags: 1, title: 1 })
    ).toEqual([
      { tags: [], title: 'Errands' },
      { tags: [], title: 'Shopping' }
    ])
    await expect(
      NotesModel.bulkWrite([{ insertOne: { document: { title: '' } } }])
    ).rejects.toBeInstanceOf(z.ZodError)
  })
})

describe('aggregate', () => {
  test('validates each document with the schema it is given', async () => {
    await NotesModel.insertMany([
      { tags: ['home'], title: 'One' },
      { tags: ['home'], title: 'Two' }
    ])

    const counts = await NotesModel.aggregate(
      [{ $unwind: '$tags' }, { $group: { _id: '$tags', count: { $sum: 1 } } }],
      { schema: z.object({ _id: z.string(), count: z.number().int() }) }
    )

    expect(counts).toEqual([{ _id: 'home', count: 2 }])
    expectTypeOf(counts).toEqualTypeOf<Array<{ _id: string; count: number }>>()
    await expect(
      NotesModel.aggregate([{ $project: { title: 1 } }], {
        schema: z.object({ title: z.number() })
      })
    ).rejects.toBeInstanceOf(z.ZodError)
  })

  test('returns the documents as they are without a schema', async () => {
    await NotesModel.insertOne({ title: 'One' })

    expect(await NotesModel.aggregate([{ $project: { _id: 0, title: 1 } }])).toEqual([
      { title: 'One' }
    ])
  })
})

describe('db', () => {
  test('resolves a function on the first operation, once', async () => {
    const getDb = vi.fn<() => Db>(() => db)
    const LazyModel = mongozod({ collection: 'notes', db: getDb, schema: noteSchema })

    expect(getDb).not.toHaveBeenCalled()

    await LazyModel.countDocuments()
    await LazyModel.insertOne({ title: 'One' })

    expect(getDb).toHaveBeenCalledOnce()
    expect(LazyModel.db).toBe(db)
    expect(LazyModel.name).toBe('notes')
  })
})

describe('schemas', () => {
  test('validates each type of a discriminated union', async () => {
    const EventsModel = mongozod({
      collection: 'events',
      db,
      schema: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('click'), url: z.url() }),
        z.object({ kind: z.literal('view'), seconds: z.number().int() })
      ])
    })

    const { document } = await EventsModel.insertOne({ kind: 'view', seconds: 3 })

    expect(document).toEqual({ _id: expect.any(ObjectId), kind: 'view', seconds: 3 })
    await expect(EventsModel.insertOne({ kind: 'click', url: 'nope' })).rejects.toBeInstanceOf(
      z.ZodError
    )
  })

  test('takes Zod Mini schemas and still throws a ZodError', async () => {
    const TagsModel = mongozod({
      collection: 'tags',
      db,
      schema: zm.object({ name: zm.string().check(zm.minLength(1)) })
    })

    expect((await TagsModel.insertOne({ name: 'home' })).document).toMatchObject({ name: 'home' })
    await expect(TagsModel.insertOne({ name: '' })).rejects.toBeInstanceOf(z.ZodError)
  })

  test('rejects field names with a dot or a leading $, at any level', () => {
    expect(() =>
      mongozod({ collection: 'notes', db, schema: z.object({ 'a.b': z.string() }) })
    ).toThrow('"a.b" is not a valid field name')
    expect(() =>
      mongozod({
        collection: 'notes',
        db,
        schema: z.object({ items: z.array(z.object({ $price: z.number() })).optional() })
      })
    ).toThrow('"$price" in "items" is not a valid field name')
    expect(() =>
      mongozod({
        collection: 'notes',
        db,
        schema: z.object({
          payment: z.discriminatedUnion('method', [
            z.object({ 'card.last4': z.string(), 'method': z.literal('card') })
          ])
        })
      })
    ).toThrow('"card.last4" in "payment" is not a valid field name')
  })

  test('accepts recursive schemas and leaves record keys to the writes', () => {
    const nodeSchema = z.object({
      value: z.string(),
      get children() {
        return z.array(nodeSchema)
      }
    })

    expect(() =>
      mongozod({
        collection: 'trees',
        db,
        schema: z.object({ metadata: z.record(z.string(), z.number()), root: nodeSchema })
      })
    ).not.toThrow()
  })
})
