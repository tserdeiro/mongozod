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

import { mongozod } from './mongozod'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-timestamps')

beforeAll(() => client.connect())
afterAll(() => client.close())
beforeEach(() => db.dropDatabase())

/** The documented form: a Date, or an ISO date that a codec decodes into one, with a default. */
const timestampSchema = z
  .union([
    z.date(),
    z.codec(z.iso.datetime(), z.date(), {
      decode: (iso) => new Date(iso),
      encode: (date) => date.toISOString()
    })
  ])
  .default(() => new Date())

const noteSchema = z.object({
  _id: z.uuidv4().default(() => crypto.randomUUID()),
  createdAt: timestampSchema,
  tags: z.array(z.string()).default([]),
  title: z.string(),
  updatedAt: timestampSchema
})

const NotesModel = mongozod({ collection: 'notes', db, schema: noteSchema, timestamps: true })

const source = new Date('2020-01-01T00:00:00Z')

describe('inserts', () => {
  test('stamp createdAt and give updatedAt the same value', async () => {
    const before = Date.now()
    const { document } = await NotesModel.insertOne({ title: 'One' })

    expect(document.createdAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(document.updatedAt).toEqual(document.createdAt)
  })

  test('keep the dates given, such as the creation date of the source', async () => {
    const { document } = await NotesModel.insertOne({
      createdAt: '2020-01-01T00:00:00Z',
      title: 'One'
    })
    const both = await NotesModel.insertOne({
      createdAt: source,
      title: 'Two',
      updatedAt: new Date(0)
    })

    expect(document).toMatchObject({ createdAt: source, updatedAt: source })
    expect(both.document).toMatchObject({ createdAt: source, updatedAt: new Date(0) })
  })

  test('stamp every document of insertMany with the same date', async () => {
    const { documents } = await NotesModel.insertMany([{ title: 'One' }, { title: 'Two' }])

    expect(documents[0]?.createdAt).toEqual(documents[1]?.createdAt)
  })

  test('skip the stamps with timestamps: false, leaving the defaults of the schema', async () => {
    const { document } = await NotesModel.insertOne(
      { createdAt: source, title: 'One' },
      { timestamps: false }
    )

    expect(document.createdAt).toEqual(source)
    expect(document.updatedAt).not.toEqual(source)
  })
})

describe('updates', () => {
  test('stamp updatedAt and leave createdAt as it was', async () => {
    const { insertedId } = await NotesModel.insertOne({ createdAt: source, title: 'One' })

    await NotesModel.updateOne({ _id: insertedId }, { $set: { title: 'Two' } })

    const note = await NotesModel.findOne({ _id: insertedId })

    expect(note?.createdAt).toEqual(source)
    expect(note?.updatedAt.getTime()).toBeGreaterThan(source.getTime())
  })

  test('an upsert stamps createdAt, or keeps the one $setOnInsert gives', async () => {
    await NotesModel.updateOne({ title: 'One' }, { $set: { tags: ['a'] } }, { upsert: true })
    await NotesModel.updateOne(
      { title: 'Two' },
      { $setOnInsert: { createdAt: source } },
      { upsert: true }
    )

    const [one, two] = await NotesModel.find().sort({ title: 1 })

    expect(one?.createdAt).toEqual(one?.updatedAt)
    expect(two?.createdAt).toEqual(source)
    expect(noteSchema.parse(one)).toEqual(one)
  })

  test('do not write the stamped fields, unless timestamps: false', async () => {
    const { insertedId } = await NotesModel.insertOne({ title: 'One' })

    await expect(
      // @ts-expect-error updatedAt is set by timestamps
      NotesModel.updateOne({ _id: insertedId }, { $set: { updatedAt: source } })
    ).rejects.toBeInstanceOf(z.ZodError)
    await expect(
      // @ts-expect-error createdAt is set by timestamps
      NotesModel.updateMany({}, { $set: { createdAt: source } })
    ).rejects.toBeInstanceOf(z.ZodError)

    await NotesModel.updateOne(
      { _id: insertedId },
      { $set: { createdAt: source, updatedAt: source } },
      { timestamps: false }
    )

    expect(await NotesModel.findOne({ _id: insertedId })).toMatchObject({
      createdAt: source,
      updatedAt: source
    })
  })

  test('stamp the writes of bulkWrite, unless timestamps: false', async () => {
    await NotesModel.bulkWrite([
      { insertOne: { document: { createdAt: source, title: 'One' } } },
      { updateOne: { filter: { title: 'One' }, update: { $set: { tags: ['a'] } } } }
    ])

    const stamped = await NotesModel.findOne({ title: 'One' })

    await NotesModel.bulkWrite(
      [{ updateOne: { filter: { title: 'One' }, update: { $set: { updatedAt: source } } } }],
      { timestamps: false }
    )

    expect(stamped?.updatedAt.getTime()).toBeGreaterThan(source.getTime())
    expect(await NotesModel.findOne({ title: 'One' })).toMatchObject({ updatedAt: source })
  })
})

describe('the option', () => {
  test('renames each field or turns it off', async () => {
    const EventsModel = mongozod({
      collection: 'events',
      db,
      schema: z.object({ created_at: timestampSchema, name: z.string() }),
      timestamps: { createdAt: 'created_at', updatedAt: false }
    })

    const { document } = await EventsModel.insertOne({ name: 'signup' })

    expect(document.created_at).toBeInstanceOf(Date)
    expect(document).not.toHaveProperty('updatedAt')
  })

  test('needs the fields in the schema, taking a Date, with a default', () => {
    expect(() =>
      // @ts-expect-error the schema has no updatedAt
      mongozod({
        collection: 'notes',
        db,
        schema: z.object({ createdAt: timestampSchema }),
        timestamps: true
      })
    ).toThrow('timestamps needs the field "updatedAt" in the schema')

    expectTypeOf(() =>
      // @ts-expect-error createdAt has no default
      mongozod({
        collection: 'notes',
        db,
        schema: z.object({ createdAt: z.date(), updatedAt: timestampSchema }),
        timestamps: true
      })
    ).toBeFunction()
    expect(() =>
      // @ts-expect-error createdAt does not take a Date
      mongozod({
        collection: 'notes',
        db,
        schema: z.object({ createdAt: z.string().default(''), updatedAt: timestampSchema }),
        timestamps: true
      })
    ).toThrow('timestamps writes a Date in "createdAt"')
  })

  test('needs the fields in every type of document', () => {
    expect(() =>
      // @ts-expect-error a view has no updatedAt
      mongozod({
        collection: 'events',
        db,
        schema: z.discriminatedUnion('kind', [
          z.object({
            createdAt: timestampSchema,
            kind: z.literal('click'),
            updatedAt: timestampSchema
          }),
          z.object({ createdAt: timestampSchema, kind: z.literal('view') })
        ]),
        timestamps: true
      })
    ).toThrow('timestamps needs the field "updatedAt" in the schema')
  })

  test('takes timestamps: false only on the models that have timestamps', async () => {
    const PlainModel = mongozod({ collection: 'plain', db, schema: z.object({ name: z.string() }) })

    // @ts-expect-error the model has no timestamps
    const { document } = await PlainModel.insertOne({ name: 'x' }, { timestamps: false })

    expect(document).toMatchObject({ name: 'x' })
  })
})
