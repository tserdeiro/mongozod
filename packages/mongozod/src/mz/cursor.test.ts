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

import { cursor } from './cursor'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-mz-cursor')

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
  color: z.string().optional(),
  createdAt: dateSchema.default(() => new Date()),
  deletedAt: dateSchema.nullable(),
  items: z.array(z.object({ position: z.number() })),
  title: z.string()
})

const notesCursor = cursor(noteSchema, { createdAt: -1, title: 1, _id: -1 })

describe('a cursor from a client', () => {
  test('turns the last document of a page into the filter of the next one', () => {
    expect(notesCursor.parse({ _id: 'n4', createdAt: '2026-10-05T10:00:00Z', title: 'B' })).toEqual(
      {
        $or: [
          { createdAt: { $lt: new Date('2026-10-05T10:00:00Z') } },
          { createdAt: new Date('2026-10-05T10:00:00Z'), title: { $gt: 'B' } },
          { _id: { $lt: 'n4' }, createdAt: new Date('2026-10-05T10:00:00Z'), title: 'B' }
        ]
      }
    )
  })

  test('takes every field of the sort, and the first page gets what the project says', () => {
    expect(notesCursor.safeParse({ _id: 'n4', title: 'B' }).success).toBe(false)
    expect(
      notesCursor.safeParse({ _id: 'n4', color: 'red', createdAt: new Date(), title: 'B' }).success
    ).toBe(false)
    expect(z.object({ cursor: notesCursor.default({}) }).parse({})).toEqual({ cursor: {} })
    expectTypeOf<z.input<typeof notesCursor>>().toEqualTypeOf<{
      _id: string
      createdAt: string | Date
      title: string
    }>()
  })
})

describe('the declarations', () => {
  test('the sort ends with _id, which breaks ties', () => {
    // @ts-expect-error _id is missing
    expect(() => cursor(noteSchema, { createdAt: -1 })).toThrow(
      'mz.cursor: the sort ends with _id, which breaks ties'
    )
    // The types cannot see the order of the keys: only the runtime catches this one.
    expect(() => cursor(noteSchema, { _id: -1, createdAt: -1 })).toThrow('the sort ends with _id')
  })

  test('its fields are required, outside arrays', () => {
    // @ts-expect-error a missing color sorts before any other
    expect(() => cursor(noteSchema, { color: 1, _id: 1 })).toThrow(
      'mz.cursor: "color" can be missing or null: a cursor sorts by required fields'
    )
    // @ts-expect-error a null deletedAt sorts before any other
    expect(() => cursor(noteSchema, { deletedAt: 1, _id: 1 })).toThrow('"deletedAt" can be missing')
    // @ts-expect-error a field inside an array
    expect(() => cursor(noteSchema, { 'items.position': 1, '_id': 1 })).toThrow(
      'mz.cursor: "items.position" goes through an array: mz.cursor takes paths outside arrays'
    )
  })
})

test('pages through MongoDB without repeating or skipping documents, with equal dates', async () => {
  const NotesModel = mongozod({ collection: 'notes', db, schema: noteSchema })
  const sameInstant = new Date('2026-10-05T10:00:00Z')
  const listInput = z.object({ cursor: notesCursor.default({}) })

  await NotesModel.insertMany(
    Array.from({ length: 7 }, (_, index) => ({
      _id: `n${index}`,
      createdAt: index < 4 ? sameInstant : new Date(Date.UTC(2026, 9, index)),
      deletedAt: null,
      items: [],
      title: index % 2 === 0 ? 'A' : 'B'
    }))
  )

  const seen: string[] = []
  let input = listInput.parse({})

  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- each page needs the last document of the one before
    const page = await NotesModel.find(input.cursor)
      .sort({ createdAt: -1, title: 1, _id: -1 })
      .limit(3)
    const last = page.at(-1)

    if (!last) break

    seen.push(...page.map((note) => note._id))
    input = listInput.parse({
      cursor: { _id: last._id, createdAt: last.createdAt.toISOString(), title: last.title }
    })
  }

  const all = await NotesModel.find().sort({ createdAt: -1, title: 1, _id: -1 })

  expect(seen).toEqual(all.map((note) => note._id))
})
