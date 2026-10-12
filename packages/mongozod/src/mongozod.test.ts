import type { ReadOf } from './index'
import type { Db, WithId } from 'mongodb'

import { AsyncLocalStorage } from 'node:async_hooks'

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
import { definePlugin } from './plugins/plugin'

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

  test('writes nothing when one document is invalid, and names each by its index', async () => {
    await expect(
      NotesModel.insertMany([{ title: 'One' }, { title: '' }, { title: '' }])
    ).rejects.toMatchObject({ issues: [{ path: [1, 'title'] }, { path: [2, 'title'] }] })
    await expect(
      NotesModel.bulkWrite([
        { insertOne: { document: { title: 'One' } } },
        { updateOne: { filter: {}, update: { $set: { title: '' } } } }
      ])
    ).rejects.toMatchObject({ issues: [{ path: [1, '$set', 'title'] }] })
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

describe('the strings of Mongoose', () => {
  test('do not compile as a sort, a projection or a populate, and throw a ZodError', async () => {
    await NotesModel.insertMany([{ title: 'B' }, { title: 'A' }])

    const rejected = [
      // @ts-expect-error sort takes an object such as { createdAt: -1 }, not a string
      NotesModel.find({}, { sort: '-title' }),
      // @ts-expect-error sort takes an object such as { createdAt: -1 }, not a string
      NotesModel.find({}).sort('-title'),
      // @ts-expect-error projection takes an object such as { name: 1 }, not a string
      NotesModel.findOne({}, { projection: 'title' })
    ]

    for (const result of await Promise.allSettled(rejected)) {
      expect(result).toMatchObject({ reason: expect.any(z.ZodError), status: 'rejected' })
    }
  })
})

describe('filters', () => {
  test('are checked against the schema in every operation', async () => {
    await NotesModel.insertMany([
      { author: { name: 'Ana' }, tags: ['home', 'work'], title: 'One' },
      { tags: ['home'], title: 'Two' }
    ])

    expect(await NotesModel.countDocuments({ 'author.name': 'Ana', 'tags': 'work' })).toBe(1)
    expect(await NotesModel.countDocuments({ author: null })).toBe(1)
    expect(await NotesModel.find({ tags: { $all: ['home'], $size: 1 } })).toMatchObject([
      { title: 'Two' }
    ])

    // @ts-expect-error "author.nickame" is not a path of the document
    await NotesModel.countDocuments({ 'author.nickame': 'A' })
    // @ts-expect-error a title is a string
    await NotesModel.deleteMany({ title: { $in: [1] } })
  })

  test('check sort keys in the options and in the cursor', async () => {
    await NotesModel.insertMany([{ title: 'B' }, { title: 'A' }])

    expect(await NotesModel.findOne({}, { sort: { title: 1 } })).toMatchObject({ title: 'A' })
    expect(await NotesModel.find().sort({ title: -1 }).limit(1)).toMatchObject([{ title: 'B' }])

    // @ts-expect-error "name" is not a path of the document
    await NotesModel.findOne({}, { sort: { name: 1 } })
    // Only checks the types: the driver rejects the direction before sending it.
    expectTypeOf(() =>
      // @ts-expect-error a direction is 1, -1, asc, desc, ascending, descending or $meta
      NotesModel.find().sort({ title: 2 })
    ).toBeFunction()
  })

  test('type distinct by its key', async () => {
    await NotesModel.insertMany([
      { tags: ['home', 'work'], title: 'One' },
      { tags: ['home'], title: 'Two' }
    ])

    const tags = await NotesModel.distinct('tags', { title: { $ne: 'Three' } })

    expect(tags.toSorted()).toEqual(['home', 'work'])
    expectTypeOf(tags).toEqualTypeOf<string[]>()

    // @ts-expect-error "label" is not a path of the document
    await NotesModel.distinct('label')
  })

  test('check the $match stages that still see the documents of the model', async () => {
    await NotesModel.insertMany([{ title: 'One' }, { title: 'Two' }])

    const titles = await NotesModel.aggregate([
      { $match: { title: { $in: ['One', 'Two'] } } },
      { $sort: { title: 1 } },
      { $match: { title: { $ne: 'Two' } } },
      { $group: { _id: '$title' } },
      { $match: { anything: { $exists: false } } }
    ])

    expect(titles).toEqual([{ _id: 'One' }])

    // @ts-expect-error a title is a string
    await NotesModel.aggregate([{ $limit: 5 }, { $match: { title: 1 } }])
  })

  test('check the filters of bulkWrite', async () => {
    await NotesModel.insertMany([{ tags: ['home'], title: 'One' }, { title: 'Two' }])

    const { deletedCount } = await NotesModel.bulkWrite([
      { deleteMany: { filter: { tags: 'home' } } }
    ])

    expect(deletedCount).toBe(1)

    // @ts-expect-error "name" is not a path of the document
    await NotesModel.bulkWrite([{ deleteOne: { filter: { name: 'x' } } }])
  })
})

describe('runtime validation of updates', () => {
  test('parses each value with its field and never writes undefined', async () => {
    const { insertedId } = await NotesModel.insertOne({ summary: 'Milk', title: 'Groceries' })

    await NotesModel.updateOne(
      { _id: insertedId },
      { $set: { createdAt: '2026-10-10T12:00:00Z', summary: undefined, title: 'Errands' } }
    )

    expect(await NotesModel.findOne({ _id: insertedId })).toMatchObject({
      createdAt: new Date('2026-10-10T12:00:00Z'),
      summary: 'Milk',
      title: 'Errands'
    })
    await expect(
      NotesModel.updateOne({ _id: insertedId }, { $set: { title: '' } })
    ).rejects.toBeInstanceOf(z.ZodError)
  })

  test('an upsert inserts a valid document, with the defaults its update lacks', async () => {
    await NotesModel.updateOne(
      { title: 'Groceries' },
      { $set: { 'author.name': 'Ana' } },
      { upsert: true }
    )

    const inserted = await NotesModel.findOne({ title: 'Groceries' })

    expect(inserted).toEqual({
      _id: expect.any(String),
      author: { name: 'Ana' },
      createdAt: expect.any(Date),
      tags: [],
      title: 'Groceries'
    })
    expect(noteSchema.parse(inserted)).toEqual(inserted)

    // On an existing document, the defaults go in $setOnInsert and change nothing.
    await NotesModel.updateOne({ title: 'Groceries' }, { $push: { tags: 'home' } })
    await NotesModel.updateOne(
      { title: 'Groceries' },
      { $set: { summary: 'Milk' } },
      { upsert: true }
    )

    expect(await NotesModel.findOne({ title: 'Groceries' })).toMatchObject({
      summary: 'Milk',
      tags: ['home']
    })
  })

  test('an upsert that would insert an invalid document throws and writes nothing', async () => {
    await expect(
      NotesModel.updateOne(
        { _id: crypto.randomUUID() },
        { $push: { tags: 'home' } },
        { upsert: true }
      )
    ).rejects.toBeInstanceOf(z.ZodError)
    await expect(
      NotesModel.bulkWrite([
        {
          updateOne: { filter: { tags: 'x' }, update: { $set: { summary: 'Milk' } }, upsert: true }
        }
      ])
    ).rejects.toBeInstanceOf(z.ZodError)
    expect(await NotesModel.countDocuments()).toBe(0)
  })

  test('an upsert of a replacement needs the _id in its filter', async () => {
    await expect(
      NotesModel.replaceOne({ title: 'One' }, { title: 'Two' }, { upsert: true })
    ).rejects.toBeInstanceOf(z.ZodError)

    const _id = crypto.randomUUID()

    await NotesModel.replaceOne({ _id }, { title: 'Two' }, { upsert: true })

    expect(await NotesModel.findOne({ _id })).toMatchObject({ _id, title: 'Two' })

    // The filter's _id goes into the document it inserts, which the schema validates.
    await Promise.all(
      [{ _id: null }, { _id: undefined }, { _id: 'not a uuid' }].map((filter) =>
        expect(
          // @ts-expect-error the _id of the notes is a UUID
          NotesModel.replaceOne(filter, { title: 'Three' }, { upsert: true })
        ).rejects.toBeInstanceOf(z.ZodError)
      )
    )

    expect(await db.collection('notes').countDocuments({ title: 'Three' })).toBe(0)
  })

  test('rejects keys no path can reach, such as those of a record', async () => {
    const MetricsModel = mongozod({
      collection: 'metrics',
      db,
      schema: z.object({ counters: z.record(z.string(), z.number()) })
    })

    await expect(MetricsModel.insertOne({ counters: { 'a.b': 1 } })).rejects.toBeInstanceOf(
      z.ZodError
    )
    await expect(
      MetricsModel.updateMany({}, { $set: { counters: { $gt: 1 } } })
    ).rejects.toBeInstanceOf(z.ZodError)
  })
})

describe('updates', () => {
  test('are checked against the schema and run as the driver runs them', async () => {
    const { insertedId } = await NotesModel.insertOne({ tags: ['home'], title: 'One' })

    await NotesModel.updateOne(
      { _id: insertedId },
      { $push: { tags: 'work' }, $set: { 'author.name': 'Ana' } }
    )

    expect(await NotesModel.findOne({ _id: insertedId })).toMatchObject({
      author: { name: 'Ana' },
      tags: ['home', 'work']
    })

    // @ts-expect-error a title is required, so it cannot be unset
    await NotesModel.updateMany({}, { $unset: { title: '' } }).catch(() => undefined)
    // @ts-expect-error tags is not a number
    await NotesModel.updateOne({}, { $inc: { tags: 1 } }).catch(() => undefined)
  })

  test('check arrayFilters against the identifiers of the update', async () => {
    const ConnectionsModel = mongozod({
      collection: 'connections',
      db,
      schema: z.object({
        accounts: z.array(z.object({ _id: z.string(), enabled: z.boolean() })),
        name: z.string()
      })
    })

    await ConnectionsModel.insertOne({
      accounts: [
        { _id: 'a', enabled: false },
        { _id: 'b', enabled: false }
      ],
      name: 'Ads'
    })
    await ConnectionsModel.updateOne(
      { name: 'Ads' },
      { $set: { 'accounts.$[account].enabled': true } },
      { arrayFilters: [{ 'account._id': 'b' }] }
    )

    expect(await ConnectionsModel.distinct('accounts.enabled', { 'accounts._id': 'b' })).toEqual([
      false,
      true
    ])

    expectTypeOf(() =>
      // @ts-expect-error $[account] needs arrayFilters
      ConnectionsModel.updateOne({}, { $set: { 'accounts.$[account].enabled': true } })
    ).toBeFunction()
  })

  test('check the updates of bulkWrite and findOneAndUpdate', async () => {
    const { insertedId } = await NotesModel.insertOne({ title: 'One' })
    const updated = await NotesModel.findOneAndUpdate(
      { _id: insertedId },
      { $set: { title: 'Two' } },
      { returnDocument: 'after' }
    )

    expect(updated).toMatchObject({ title: 'Two' })
    expect(
      await NotesModel.bulkWrite([
        { updateOne: { filter: { _id: insertedId }, update: { $addToSet: { tags: 'x' } } } }
      ])
    ).toMatchObject({ modifiedCount: 1 })

    expectTypeOf(() =>
      // @ts-expect-error an element of tags is a string
      NotesModel.bulkWrite([{ updateMany: { filter: {}, update: { $addToSet: { tags: 1 } } } }])
    ).toBeFunction()
  })
})

describe('db', () => {
  test('resolves a function on every operation, and keeps the collection of each database', async () => {
    const getDb = vi.fn<() => Db>(() => db)
    const LazyModel = mongozod({ collection: 'notes', db: getDb, schema: noteSchema })

    expect(getDb).not.toHaveBeenCalled()

    await LazyModel.countDocuments()
    await LazyModel.insertOne({ title: 'One' })

    expect(getDb).toHaveBeenCalledTimes(2)
    expect(LazyModel.db).toBe(db)
    expect(LazyModel.collection).toBe(LazyModel.collection)
    expect(LazyModel.name).toBe('notes')
  })

  test("gives each request its tenant's database, as an AsyncLocalStorage returns it", async () => {
    const tenants = new AsyncLocalStorage<Db>()
    const tenantDb = client.db('mongozod-tenant')
    const TenantNotesModel = mongozod({
      collection: 'notes',
      db: () => tenants.getStore() ?? db,
      schema: noteSchema
    })

    await tenantDb.dropDatabase()
    await tenants.run(tenantDb, () => TenantNotesModel.insertOne({ title: 'Tenant' }))
    await TenantNotesModel.insertOne({ title: 'Default' })

    expect(await tenantDb.collection('notes').countDocuments()).toBe(1)
    expect(await tenants.run(tenantDb, () => TenantNotesModel.findOne({}))).toMatchObject({
      title: 'Tenant'
    })

    // A cursor reads the database of where it is created, though it starts on its first read.
    const cursor = tenants.run(tenantDb, () => TenantNotesModel.find({}))
    const pipeline = tenants.run(tenantDb, () => TenantNotesModel.aggregate([]))

    expect((await cursor).map((note) => note.title)).toEqual(['Tenant'])
    expect(await pipeline).toMatchObject([{ title: 'Tenant' }])
  })

  test('runs a cursor in the async context it is created in, like a promise', async () => {
    const tenants = new AsyncLocalStorage<Db>()
    const tenantDb = client.db('mongozod-tenant')
    const seen: Array<Db | undefined> = []
    const UsersModel = mongozod({
      collection: 'users',
      db: () => tenants.getStore() ?? db,
      schema: z.object({ _id: z.string(), name: z.string() })
    })
    const PostsModel = mongozod({
      collection: 'posts',
      db: () => tenants.getStore() ?? db,
      plugins: [
        definePlugin({
          hooks: { find: { before: () => void seen.push(tenants.getStore()) } },
          id: 'tenant'
        })
      ],
      references: { author: () => UsersModel },
      schema: z.object({ _id: z.string(), author: z.string(), title: z.string() })
    })

    await tenantDb.dropDatabase()
    await UsersModel.insertOne({ _id: 'u', name: 'Default' })
    await tenants.run(tenantDb, async () => {
      await UsersModel.insertOne({ _id: 'u', name: 'Tenant' })
      await PostsModel.insertOne({ _id: 'p', author: 'u', title: 'Tenant' })
    })

    // Read after the request: the hooks and the reads of `populate` still see its tenant.
    const cursor = tenants.run(tenantDb, () => PostsModel.find({}, { populate: { author: true } }))

    expect(await cursor).toEqual([
      { _id: 'p', author: { _id: 'u', name: 'Tenant' }, title: 'Tenant' }
    ])
    expect(seen).toEqual([tenantDb])

    // The function runs on the first read, which rejects when it throws.
    const FailingModel = mongozod({
      collection: 'notes',
      db: () => {
        throw new Error('no tenant')
      },
      schema: noteSchema
    })
    const failing = FailingModel.find({})

    await expect(failing.toArray()).rejects.toThrow('no tenant')
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

  test('takes types with subtypes: a discriminated union of discriminated unions', async () => {
    const car = z.object({ kind: z.literal('car'), wheels: z.number().int() })
    const vehicleSchema = z.discriminatedUnion('kind', [
      z.discriminatedUnion('fuel', [
        car.extend({ fuel: z.literal('electric'), kwh: z.number() }),
        car.extend({ fuel: z.literal('gas'), liters: z.number() })
      ]),
      z.object({ gears: z.number().int(), kind: z.literal('bike') })
    ])
    const VehiclesModel = mongozod({ collection: 'vehicles', db, schema: vehicleSchema })

    const { document } = await VehiclesModel.insertOne({
      fuel: 'electric',
      kind: 'car',
      kwh: 60,
      wheels: 4
    })

    await expect(
      // @ts-expect-error a gas car has liters, not kwh
      VehiclesModel.insertOne({ fuel: 'gas', kind: 'car', kwh: 60, wheels: 4 })
    ).rejects.toBeInstanceOf(z.ZodError)

    // The fields of every subtype of a type need only its discriminator.
    await VehiclesModel.updateOne({ _id: document._id, kind: 'car' }, { $set: { wheels: 3 } })
    await VehiclesModel.updateOne(
      { _id: document._id, fuel: 'electric', kind: 'car' },
      { $set: { kwh: 70 } }
    )
    await expect(
      // @ts-expect-error "kwh" is not in every type allowed: fix "fuel" in the filter
      VehiclesModel.updateOne({ _id: document._id, kind: 'car' }, { $set: { kwh: 70 } })
    ).rejects.toBeInstanceOf(z.ZodError)

    const found = await VehiclesModel.findOne({ _id: document._id })

    expect(found).toMatchObject({ kwh: 70, wheels: 3 })
    expectTypeOf(found).toEqualTypeOf<WithId<
      | { fuel: 'electric'; kind: 'car'; kwh: number; wheels: number }
      | { fuel: 'gas'; kind: 'car'; liters: number; wheels: number }
      | { gears: number; kind: 'bike' }
    > | null>()
    // timestamps and plugins need their fields in each subtype.
    expect(() =>
      // @ts-expect-error the gas cars have no createdAt
      mongozod({
        collection: 'vehicles',
        db,
        schema: z.discriminatedUnion('kind', [
          z.discriminatedUnion('fuel', [
            car.extend({ createdAt: z.date(), fuel: z.literal('electric') }),
            car.extend({ fuel: z.literal('gas') })
          ]),
          z.object({ createdAt: z.date(), kind: z.literal('bike') })
        ]),
        timestamps: { createdAt: true }
      })
    ).toThrow('timestamps needs the field "createdAt" in the schema')
  })

  test('a read returns the types of document its filter allows, like an update writes', async () => {
    const car = z.object({ kind: z.literal('car'), wheels: z.number().int() })
    const VehiclesModel = mongozod({
      collection: 'vehicles',
      db,
      schema: z.discriminatedUnion('kind', [
        z.discriminatedUnion('fuel', [
          car.extend({ fuel: z.literal('electric'), kwh: z.number() }),
          car.extend({ fuel: z.literal('gas'), liters: z.number() })
        ]),
        z.object({ gears: z.number().int(), kind: z.literal('bike') })
      ])
    })

    await VehiclesModel.insertMany([
      { fuel: 'electric', kind: 'car', kwh: 60, wheels: 4 },
      { gears: 21, kind: 'bike' }
    ])

    const cars = await VehiclesModel.find({ kind: 'car' }, { projection: { _id: 0 } })
    const electric = await VehiclesModel.findOne({
      $and: [{ kind: { $in: ['car'] } }, { fuel: { $eq: 'electric' } }]
    })
    const [bike] = await VehiclesModel.find({ kind: 'bike' }).project({ _id: 0, gears: 1 })

    expect(cars).toEqual([{ fuel: 'electric', kind: 'car', kwh: 60, wheels: 4 }])
    expect(electric?.kwh).toBe(60)
    expect(bike).toEqual({ gears: 21 })
    expectTypeOf(cars).toEqualTypeOf<
      Array<
        | { fuel: 'electric'; kind: 'car'; kwh: number; wheels: number }
        | { fuel: 'gas'; kind: 'car'; liters: number; wheels: number }
      >
    >()
    expectTypeOf(electric).toEqualTypeOf<WithId<{
      fuel: 'electric'
      kind: 'car'
      kwh: number
      wheels: number
    }> | null>()
    expectTypeOf(bike).toEqualTypeOf<{ gears: number } | undefined>()
    expectTypeOf<ReadOf<typeof VehiclesModel, { filter: { kind: 'bike' } }>>().toEqualTypeOf<
      WithId<{ gears: number; kind: 'bike' }>
    >()
  })

  test('a type whose discriminator is an enum is allowed when the filter fixes one of its values', async () => {
    const EventsModel = mongozod({
      collection: 'events',
      db,
      schema: z.discriminatedUnion('type', [
        z.object({ type: z.literal('click'), x: z.number() }),
        z.object({ type: z.enum(['impression', 'view']), url: z.string() })
      ])
    })

    await EventsModel.insertMany([
      { type: 'click', x: 1 },
      { type: 'view', url: 'https://a.b' }
    ])
    await EventsModel.updateOne({ type: 'view' }, { $set: { url: 'https://c.d' } })

    const views = await EventsModel.find({ type: 'view' }, { projection: { _id: 0 } })
    const both = await EventsModel.find({ type: { $in: ['click', 'view'] } })

    expect(views).toEqual([{ type: 'view', url: 'https://c.d' }])
    expect(both).toHaveLength(2)
    expectTypeOf(views).toEqualTypeOf<Array<{ type: 'impression' | 'view'; url: string }>>()
    expectTypeOf<(typeof both)[number]['type']>().toEqualTypeOf<'click' | 'impression' | 'view'>()
    await expect(
      // @ts-expect-error not every type the filter allows has url
      EventsModel.updateOne({ type: { $in: ['click', 'view'] } }, { $set: { url: 'x' } })
    ).rejects.toBeInstanceOf(z.ZodError)
  })

  test('takes the keys of a record typed as a pattern, and the indexes of a tuple', async () => {
    const ItemsModel = mongozod({
      collection: 'items',
      db,
      schema: z.object({
        metadata: z.record(z.string(), z.number()),
        pair: z.tuple([z.string(), z.number()])
      })
    })
    const key: string = 'clicks'
    const clicks: Record<`metadata.${string}`, number> = { [`metadata.${key}`]: 2 }

    await ItemsModel.insertOne({ metadata: { clicks: 1 }, pair: ['a', 1] })
    await ItemsModel.updateOne({ 'pair.0': 'a' }, { $inc: { ...clicks, 'pair.1': 2 } })

    const found = await ItemsModel.findOne(
      { 'metadata.clicks': { $gt: 2 }, 'pair.1': 3 },
      { projection: { _id: 0 } }
    )

    expect(found).toEqual({ metadata: { clicks: 3 }, pair: ['a', 3] })
    await expect(
      // @ts-expect-error the element 0 is a string
      ItemsModel.updateOne({}, { $set: { 'pair.0': 1 } })
    ).rejects.toBeInstanceOf(z.ZodError)
  })

  test('awaits async refinements in every write, such as one that checks the database', async () => {
    const handleSchema = z.object({
      handle: z
        .string()
        .refine(
          async (handle) => (await db.collection('reserved').countDocuments({ handle })) === 0,
          'is reserved'
        ),
      seenAt: z
        .date()
        .refine(async (date) => date.getTime() <= Date.now())
        .optional()
    })
    const UsersModel = mongozod({ collection: 'users', db, schema: handleSchema })

    await db.collection('reserved').insertOne({ handle: 'admin' })

    const { document } = await UsersModel.insertOne({ handle: 'ana' })
    const rejected = [
      UsersModel.insertOne({ handle: 'admin' }),
      UsersModel.insertMany([{ handle: 'luis' }, { handle: 'admin' }]),
      UsersModel.updateOne({ _id: document._id }, { $set: { handle: 'admin' } }),
      UsersModel.replaceOne({ _id: document._id }, { handle: 'admin' }),
      UsersModel.bulkWrite([{ insertOne: { document: { handle: 'admin' } } }])
    ]

    for (const result of await Promise.allSettled(rejected)) {
      expect(result).toMatchObject({
        reason: { issues: [{ message: 'is reserved' }] },
        status: 'rejected'
      })
    }

    expect(await UsersModel.countDocuments({})).toBe(1)

    // The checks of what a field stores, such as $currentDate's, take its async refinements too.
    await UsersModel.updateOne({ _id: document._id }, { $currentDate: { seenAt: true } })
  })

  test('needs useBigInt64 for a z.bigint(), so that reads have the bigint of their type', async () => {
    const ledgerSchema = z.object({ entries: z.array(z.object({ amount: z.bigint() })) })
    const LedgersModel = mongozod({ collection: 'ledgers', db, schema: ledgerSchema })

    await expect(LedgersModel.insertOne({ entries: [{ amount: 5n }] })).rejects.toThrow(
      '"entries.amount" is a z.bigint(), which the driver reads as a number unless the client sets useBigInt64: true'
    )
    await expect(LedgersModel.findOne({})).rejects.toThrow('"entries.amount" is a z.bigint()')

    const BigIntLedgersModel = mongozod({
      collection: 'ledgers',
      db: client.db('mongozod', { useBigInt64: true }),
      schema: ledgerSchema
    })

    await BigIntLedgersModel.insertOne({ entries: [{ amount: 2n ** 60n }] })

    expect((await BigIntLedgersModel.findOne({}))?.entries).toEqual([{ amount: 2n ** 60n }])
  })

  test('rejects a schema that is not a document, such as a transform of one', async () => {
    const articleSchema = z.object({ slug: z.string().optional(), title: z.string() })

    expect(() =>
      mongozod({
        collection: 'articles',
        db,
        // @ts-expect-error a transform of the whole document
        schema: articleSchema.transform((note) => ({ ...note, slug: note.title.toLowerCase() }))
      })
    ).toThrow('a transform of the whole document does not run on updates')
    expect(() =>
      // @ts-expect-error an optional document
      mongozod({ collection: 'articles', db, schema: articleSchema.optional() })
    ).toThrow(
      'the schema of a model is a z.object or a z.discriminatedUnion of objects, not a z.optional()'
    )

    // A field computed from others goes in .overwrite(), which keeps the object.
    const ArticlesModel = mongozod({
      collection: 'articles',
      db,
      schema: articleSchema.overwrite((note) => ({ ...note, slug: note.title.toLowerCase() }))
    })

    expect((await ArticlesModel.insertOne({ title: 'Hello' })).document.slug).toBe('hello')
  })

  test('rejects a z.set() or a z.map(), which the driver does not read back', () => {
    expect(() =>
      mongozod({ collection: 'notes', db, schema: z.object({ tags: z.set(z.string()) }) })
    ).toThrow(
      '"tags" is a z.set(), which the driver stores as an empty object: use mz.set() for an array without repeats'
    )
    expect(() =>
      mongozod({
        collection: 'notes',
        db,
        schema: z.object({
          items: z.array(z.object({ prices: z.map(z.string(), z.number()).optional() }))
        })
      })
    ).toThrow(
      '"items.prices" is a z.map(), which the driver stores as an object and reads as one: use z.record()'
    )
    expect(() =>
      mongozod({
        collection: 'notes',
        db,
        schema: z.object({ pair: z.tuple([z.string()], z.set(z.string())) })
      })
    ).toThrow('"pair.1" is a z.set()')
    expect(() =>
      mongozod({ collection: 'notes', db, schema: z.object({ seen: z.instanceof(Set) }) })
    ).toThrow('"seen" is a z.set()')
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
    // Each call to the getter of `z.json()` builds a new schema.
    expect(() =>
      mongozod({ collection: 'events', db, schema: z.object({ payload: z.json() }) })
    ).not.toThrow()
    // The paths the editor suggests end in a recursive union such as `z.json()`.
    expectTypeOf(() =>
      mongozod({
        collection: 'events',
        db,
        schema: z.object({ name: z.string(), payload: z.json() })
      }).find({ name: 'signup' })
    ).toBeFunction()
  })
})
