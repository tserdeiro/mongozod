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
import { filter } from '../filter'

import { date } from './date'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-codecs-date')

beforeAll(() => client.connect())
afterAll(() => client.close())
beforeEach(() => db.dropDatabase())

const noteSchema = z.object({ _id: z.string(), scheduledFor: date().optional(), title: z.string() })

const instant = new Date('2026-10-01T10:00:00.000Z')

describe('date()', () => {
  test('takes a Date or an ISO string with Z or an offset, and returns a Date', () => {
    const schema = date()

    expect(schema.parse(instant)).toEqual(instant)
    expect(schema.parse('2026-10-01T10:00:00Z')).toEqual(instant)
    expect(schema.parse('2026-10-01T07:00:00-03:00')).toEqual(instant)
    expect(schema.parse('2026-10-01T10:00:00.000Z')).toEqual(instant)
    expectTypeOf<z.input<typeof schema>>().toEqualTypeOf<string | Date>()
    expectTypeOf<z.output<typeof schema>>().toEqualTypeOf<Date>()
  })

  test('rejects anything else with one message, a string without Z or an offset too', () => {
    for (const value of ['2026-10-01T10:00:00', '2026-10-01', 'tomorrow', new Date('x'), 0, null]) {
      expect(date().safeParse(value).error?.issues).toMatchObject([
        { message: 'Invalid date: expected a Date or an ISO datetime string with Z or an offset' }
      ])
    }

    expect(date().safeParse(undefined).error?.issues).toMatchObject([
      {
        message:
          'Invalid date: expected a Date or an ISO datetime string with Z or an offset, received undefined'
      }
    ])
  })

  test('encodes back to an ISO string in UTC', () => {
    expect(z.encode(noteSchema, { _id: 'n1', scheduledFor: instant, title: 'a' })).toEqual({
      _id: 'n1',
      scheduledFor: '2026-10-01T10:00:00.000Z',
      title: 'a'
    })
  })

  test('is a date in the $jsonSchema', () => {
    expect(toJsonSchema(noteSchema).properties.scheduledFor).toEqual({ bsonType: 'date' })
  })
})

test('a model stores a Date, from an ISO string too, and mz.filter compares with one', async () => {
  const NotesModel = mongozod({ collection: 'notes', db, schema: noteSchema })
  const notesFilter = filter(noteSchema, { scheduledFor: ['$gte', '$lt'] })

  await NotesModel.insertMany([
    { _id: 'n1', scheduledFor: '2026-10-01T07:00:00-03:00', title: 'a' },
    { _id: 'n2', scheduledFor: new Date('2026-11-01T00:00:00Z'), title: 'b' }
  ])

  expect(await db.collection('notes').countDocuments({ scheduledFor: { $type: 'date' } })).toBe(2)
  expect(
    await NotesModel.find(notesFilter.parse({ scheduledFor: { $lt: '2026-10-15T00:00:00-03:00' } }))
  ).toEqual([{ _id: 'n1', scheduledFor: instant, title: 'a' }])
})
