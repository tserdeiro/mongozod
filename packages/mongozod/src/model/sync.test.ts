import { Decimal128, MongoClient, MongoServerError } from 'mongodb'
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

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-sync')

beforeAll(() => client.connect())
afterAll(() => client.close())
beforeEach(() => db.dropDatabase())

const noteSchema = z.object({
  _id: z.uuidv4().default(() => crypto.randomUUID()),
  author: z.object({ name: z.string() }).optional(),
  createdAt: z.date().default(() => new Date()),
  deletedAt: z.date().nullable().default(null),
  organization: z.string(),
  slug: z.string(),
  tags: z.array(z.string()).default([])
})

/** The validator of a collection, as the server keeps it. */
async function optionsOf(name: string) {
  const [collection] = await db.listCollections({ name }).toArray()

  return collection && 'options' in collection ? collection.options : undefined
}

describe('indexes', () => {
  const NotesModel = mongozod({
    collection: 'notes',
    db,
    indexes: (index) => [
      index({ createdAt: -1, organization: 1 }),
      index({ slug: 1 }, { partialFilterExpression: { deletedAt: null }, unique: true }),
      index({ 'author.name': 1, 'tags': 1 })
    ],
    schema: noteSchema
  })

  test('creates the declared ones and returns their names', async () => {
    expect(await NotesModel.sync()).toEqual({
      extraIndexes: [],
      indexes: ['createdAt_-1_organization_1', 'slug_1', 'author.name_1_tags_1']
    })
    expect(await NotesModel.sync()).toMatchObject({ extraIndexes: [] })

    await NotesModel.insertOne({ organization: 'o', slug: 'a' })
    await NotesModel.updateOne({ slug: 'a' }, { $set: { deletedAt: new Date() } })
    await NotesModel.insertOne({ organization: 'o', slug: 'a' })

    await expect(NotesModel.insertOne({ organization: 'o', slug: 'a' })).rejects.toThrow(
      'duplicate key'
    )
  })

  test('never drops one: it returns the ones the model does not declare', async () => {
    await NotesModel.collection.createIndex({ title: 1 }, { name: 'legacy' })

    const { extraIndexes } = await NotesModel.sync()

    expect(extraIndexes).toEqual([expect.objectContaining({ key: { title: 1 }, name: 'legacy' })])
    expect(await NotesModel.collection.indexExists('legacy')).toBe(true)
  })

  test('fails with the error of the server when an existing one differs', async () => {
    await NotesModel.collection.createIndex({ slug: 1 })

    const error = await NotesModel.sync().catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(MongoServerError)
    expect(error).toMatchObject({ code: 86, message: expect.stringContaining('slug_1') })
  })

  test('works on a collection that does not exist yet', async () => {
    const PlainModel = mongozod({ collection: 'plain', db, schema: noteSchema })

    expect(await PlainModel.sync()).toEqual({ extraIndexes: [], indexes: [] })
  })

  test('takes paths of the document, and checks the partial filter like a filter', () => {
    expect(() =>
      mongozod({
        collection: 'notes',
        db,
        // @ts-expect-error "titel" is not a path of the document
        indexes: (index) => [index({ titel: 1 })],
        schema: noteSchema
      })
    ).toThrow('index key "titel" is not a path of the document')
    expectTypeOf(() =>
      mongozod({
        collection: 'notes',
        db,
        indexes: (index) => [
          // @ts-expect-error a slug is a string
          index({ slug: 1 }, { partialFilterExpression: { slug: 1 } })
        ],
        schema: noteSchema
      })
    ).toBeFunction()
    expect(() =>
      mongozod({
        collection: 'notes',
        db,
        // @ts-expect-error an index takes at least one key
        indexes: (index) => [index({})],
        schema: noteSchema
      })
    ).toThrow('an index takes at least one key')
    expect(() =>
      mongozod({
        collection: 'notes',
        db,
        indexes: (index) => [
          // @ts-expect-error "titel" is not a path of the document
          index({ '$**': 'text' }, { weights: { 'author.name': 2, 'titel': 5 } })
        ],
        schema: noteSchema
      })
    ).toThrow('index key "titel" is not a path of the document')
    expect(() =>
      mongozod({
        collection: 'notes',
        db,
        indexes: (index) => [
          index({ '$**': 1 }),
          index({ 'author.$**': 1 }),
          index({ slug: 'text' }, { name: 'search', weights: { slug: 10 } })
        ],
        schema: noteSchema
      })
    ).not.toThrow()
  })
})

describe('jsonSchema', () => {
  test('creates the collection with the validator, which the server applies to every write', async () => {
    const NotesModel = mongozod({ collection: 'notes', db, jsonSchema: true, schema: noteSchema })

    await NotesModel.sync()

    expect(await optionsOf('notes')).toMatchObject({
      validationAction: 'error',
      validationLevel: 'strict',
      validator: { $jsonSchema: { required: expect.arrayContaining(['organization']) } }
    })

    await NotesModel.insertOne({ organization: 'o', slug: 'a' })

    // What the app cannot check: a dotted `$set` that creates a parent without its fields.
    await expect(
      NotesModel.collection.updateOne({ slug: 'a' }, { $set: { 'author.nickname': 'x' } })
    ).rejects.toMatchObject({ code: 121 })
    await expect(
      db.collection('notes').insertOne({ organization: 1, slug: 'b' })
    ).rejects.toMatchObject({ code: 121 })
  })

  test('checks the bsonType that a field declares in its metadata', async () => {
    const AccountsModel = mongozod({
      collection: 'accounts',
      db,
      jsonSchema: true,
      schema: z.object({
        balance: z.instanceof(Decimal128).meta({ bsonType: 'decimal' }),
        name: z.string()
      })
    })

    await AccountsModel.sync()
    await AccountsModel.insertOne({ balance: Decimal128.fromString('10.50'), name: 'Ana' })

    await expect(
      db.collection('accounts').insertOne({ balance: 10.5, name: 'Luis' })
    ).rejects.toMatchObject({ code: 121 })
  })

  test('replaces the validator of an existing collection, with the level and action given', async () => {
    await db.createCollection('notes', { validator: { $jsonSchema: { required: ['legacy'] } } })

    const NotesModel = mongozod({
      collection: 'notes',
      db,
      jsonSchema: { validationLevel: 'moderate' },
      schema: noteSchema
    })

    await NotesModel.sync()

    expect(await optionsOf('notes')).toMatchObject({
      validationAction: 'error',
      validationLevel: 'moderate',
      validator: { $jsonSchema: { bsonType: 'object' } }
    })
  })

  test('takes every document the app writes', async () => {
    const dateSchema = z.union([
      z.date(),
      z.codec(z.iso.datetime(), z.date(), {
        decode: (iso) => new Date(iso),
        encode: (date) => date.toISOString()
      })
    ])
    const PluginsModel = mongozod({
      collection: 'plugins',
      db,
      jsonSchema: true,
      schema: z.object({
        _id: z.uuidv4().default(() => crypto.randomUUID()),
        connections: z.array(
          z.object({
            accounts: z.array(
              z.object({
                details: z.discriminatedUnion('plugin', [
                  z.object({ customerId: z.string().nullable(), plugin: z.literal('google-ads') }),
                  z.object({ plugin: z.literal('wortise-ads') })
                ]),
                enabled: z.boolean().default(true)
              })
            ),
            metadata: z.record(z.string(), z.json()).optional(),
            syncedAt: dateSchema.optional()
          })
        ),
        createdAt: dateSchema.default(() => new Date()),
        price: z.number().int().min(0),
        status: z.enum(['active', 'expired']).default('active')
      })
    })

    await PluginsModel.sync()

    const { document } = await PluginsModel.insertOne({
      connections: [
        {
          accounts: [
            { details: { customerId: null, plugin: 'google-ads' } },
            { details: { plugin: 'wortise-ads' }, enabled: false }
          ],
          metadata: { pages: [1, 2], source: { name: 'api' } },
          syncedAt: '2026-10-10T12:00:00Z'
        }
      ],
      price: 3
    })

    expect(document.connections[0]?.syncedAt).toBeInstanceOf(Date)
    await expect(
      db.collection('plugins').insertOne({ connections: [], createdAt: 'yesterday', price: 3 })
    ).rejects.toMatchObject({ code: 121 })
  })

  test('validates every type of document of a discriminated union', async () => {
    const EventsModel = mongozod({
      collection: 'events',
      db,
      jsonSchema: true,
      schema: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('click'), url: z.string() }),
        z.strictObject({ kind: z.literal('view'), seconds: z.number() })
      ])
    })

    await EventsModel.sync()
    await EventsModel.insertMany([
      { kind: 'click', url: 'https://example.com' },
      { kind: 'view', seconds: 3 }
    ])

    await expect(
      db.collection('events').insertOne({ kind: 'view', url: 'https://example.com' })
    ).rejects.toMatchObject({ code: 121 })
  })

  test('leaves the validator of a model that does not ask for one', async () => {
    await db.createCollection('notes', { validator: { $jsonSchema: { required: ['slug'] } } })
    await mongozod({ collection: 'notes', db, schema: noteSchema }).sync()

    expect(await optionsOf('notes')).toMatchObject({
      validator: { $jsonSchema: { required: ['slug'] } }
    })
  })
})
