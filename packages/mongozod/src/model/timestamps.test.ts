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
import { date } from '../mzod/fields/date'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-timestamps')

beforeAll(() => client.connect())
afterAll(() => client.close())
beforeEach(() => db.dropDatabase())

/** The documented form: `date()`, a Date or an ISO string decoded into one, with no default. */
const timestampSchema = date()

const noteSchema = z.object({
  _id: z.uuidv4().default(() => crypto.randomUUID()),
  createdAt: timestampSchema,
  importedAt: z.date().optional(),
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

  test('take the dates as optional, also in replacements', async () => {
    const { insertedId } = await NotesModel.insertOne({ title: 'One' })

    await NotesModel.replaceOne({ _id: insertedId }, { title: 'Two' })

    expect(await NotesModel.findOne({ _id: insertedId })).toMatchObject({
      createdAt: expect.any(Date),
      title: 'Two',
      updatedAt: expect.any(Date)
    })
  })

  test('take the time of the write as the updatedAt a replacement does not give', async () => {
    const { insertedId } = await NotesModel.insertOne({ createdAt: source, title: 'One' })
    const before = new Date()

    await NotesModel.replaceOne({ _id: insertedId }, { createdAt: source, title: 'Two' })

    const replaced = await NotesModel.findOne({ _id: insertedId })

    expect(replaced?.createdAt).toEqual(source)
    expect(replaced?.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())

    const found = await NotesModel.findOneAndReplace(
      { _id: insertedId },
      { createdAt: source, title: 'Three' },
      { returnDocument: 'after' }
    )

    expect(found?.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
  })

  test('with timestamps: false, need the dates, which the schema validates', async () => {
    const { document } = await NotesModel.insertOne(
      { createdAt: source, title: 'One', updatedAt: source },
      { timestamps: false }
    )

    expect(document).toMatchObject({ createdAt: source, updatedAt: source })
    await expect(
      // @ts-expect-error timestamps: false needs updatedAt
      NotesModel.insertOne({ createdAt: source, title: 'One' }, { timestamps: false })
    ).rejects.toMatchObject({ issues: [{ path: ['updatedAt'] }] })
  })

  test('with timestamps: false, a .default() of the schema still fills them', async () => {
    const LogsModel = mongozod({
      collection: 'logs',
      db,
      schema: z.object({
        createdAt: date().default(() => source),
        title: z.string(),
        updatedAt: date().default(() => source)
      }),
      timestamps: true
    })

    const { document } = await LogsModel.insertOne({ title: 'One' }, { timestamps: false })

    expect(document).toMatchObject({ createdAt: source, updatedAt: source })
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
    await expect(
      // @ts-expect-error updatedAt is set by timestamps, also as the target of $rename
      NotesModel.updateOne({ _id: insertedId }, { $rename: { importedAt: 'updatedAt' } })
    ).rejects.toMatchObject({
      issues: [{ message: '"updatedAt" is set by timestamps: pass timestamps: false to write it' }]
    })

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
      { insertOne: { document: { title: 'Two' } } },
      { updateOne: { filter: { title: 'One' }, update: { $set: { tags: ['a'] } } } }
    ])

    const stamped = await NotesModel.findOne({ title: 'One' })

    await NotesModel.bulkWrite(
      [{ updateOne: { filter: { title: 'One' }, update: { $set: { updatedAt: source } } } }],
      { timestamps: false }
    )

    expect(stamped?.updatedAt.getTime()).toBeGreaterThan(source.getTime())
    expect(await NotesModel.findOne({ title: 'One' })).toMatchObject({ updatedAt: source })
    await expect(
      // @ts-expect-error timestamps: false needs the dates
      NotesModel.bulkWrite([{ insertOne: { document: { title: 'Three' } } }], { timestamps: false })
    ).rejects.toBeInstanceOf(z.ZodError)
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

  test('needs the fields in the schema, taking a Date', () => {
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
      mongozod({
        collection: 'notes',
        db,
        schema: z.object({ createdAt: z.date(), title: z.string(), updatedAt: z.date() }),
        timestamps: true
      }).insertOne({ title: 'One' })
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
