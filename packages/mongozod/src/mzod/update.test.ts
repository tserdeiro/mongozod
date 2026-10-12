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

import { update } from './update'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-mz-update')

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
  _id: z.uuid().default(() => crypto.randomUUID()),
  color: z.string().optional(),
  content: z.string().max(20_000).default(''),
  dueAt: dateSchema.optional(),
  items: z.array(z.object({ status: z.string() })).default([]),
  meta: z.object({ label: z.string().optional(), size: z.number() }).optional(),
  rating: z.number().optional(),
  title: z.string().min(1),
  views: z.number().int().default(0)
})

const notesUpdate = update(noteSchema, {
  $inc: ['rating', 'views'],
  $set: ['content', 'dueAt', 'meta', 'meta.size', 'title'],
  $unset: ['color', 'meta.label']
})

function issues(value: unknown) {
  const result = notesUpdate.safeParse(value)

  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
}

describe('an update from a client', () => {
  test('keeps what was sent, without defaults, and parses each value with its field', () => {
    expect(notesUpdate.parse({ $set: { title: 'New' } })).toEqual({ $set: { title: 'New' } })
    expect(
      notesUpdate.parse({ $set: { dueAt: '2026-10-01T00:00:00Z', title: undefined } })
    ).toEqual({ $set: { dueAt: new Date('2026-10-01T00:00:00Z') } })
    expect(notesUpdate.parse({ $set: { meta: { size: 1 } }, $unset: { color: '' } })).toEqual({
      $set: { meta: { size: 1 } },
      $unset: { color: '' }
    })
    expect(notesUpdate.parse({ $inc: { rating: 0.5, views: 1 } })).toEqual({
      $inc: { rating: 0.5, views: 1 }
    })
    // MongoDB takes an operator without fields, and does nothing.
    expect(notesUpdate.parse({ $set: {} })).toEqual({ $set: {} })
  })

  test('rejects what is not declared, and values their field does not take', () => {
    expect(issues({})).toEqual([': an update takes at least one operator'])
    expect(issues({ $rename: { title: 'name' } })).toEqual([': Unrecognized key: "$rename"'])
    expect(issues({ $set: { views: 2 } })).toEqual(['$set: Unrecognized key: "views"'])
    expect(issues({ $set: { title: '' } })).toHaveLength(1)
    expect(issues({ $set: { meta: { label: 'x' } } })).toHaveLength(1)
    expect(issues({ $inc: { views: 1.5 } })).toEqual([
      '$inc.views: Invalid input: expected int, received number'
    ])
    expect(issues({ $unset: { color: 'x' } })).toHaveLength(1)
  })

  test('the types of what the client sends and what the router gets', () => {
    expectTypeOf<z.input<typeof notesUpdate>>().toEqualTypeOf<{
      $inc?: { rating?: number; views?: number }
      $set?: {
        'content'?: string
        'dueAt'?: string | Date
        'meta'?: { label?: string | undefined; size: number }
        'meta.size'?: number
        'title'?: string
      }
      $unset?: { 'color'?: '' | 1 | true; 'meta.label'?: '' | 1 | true }
    }>()
    expectTypeOf<NonNullable<z.output<typeof notesUpdate>['$set']>['dueAt']>().toEqualTypeOf<
      Date | undefined
    >()
  })
})

describe('the declarations', () => {
  test('a path that does not fit its operator does not compile and throws', () => {
    // @ts-expect-error title is required
    expect(() => update(noteSchema, { $unset: ['title'] })).toThrow(
      'mz.update: "title" is required, so it cannot be unset'
    )
    // @ts-expect-error a field with a default is never missing
    expect(() => update(noteSchema, { $unset: ['views'] })).toThrow('"views" is required')
    // @ts-expect-error title is not a number
    expect(() => update(noteSchema, { $inc: ['title'] })).toThrow(
      'mz.update: "title" is not a number'
    )
    // @ts-expect-error not a path of the document
    expect(() => update(noteSchema, { $set: ['titel'] })).toThrow(
      'mz.update: "titel" is not a path of the document'
    )
    // @ts-expect-error $push is not an operator of mz.update
    expect(() => update(noteSchema, { $push: ['items'] })).toThrow(
      'mz.update: "$push" is not an operator of mz.update: use $set, $unset or $inc'
    )
    // @ts-expect-error the server rejects a change of the _id
    expect(() => update(noteSchema, { $set: ['_id', 'title'] })).toThrow(
      'mz.update: the _id is immutable'
    )
  })

  test('a path never names an element of an array: the router builds those', () => {
    // @ts-expect-error a path through an array
    expect(() => update(noteSchema, { $set: ['items.status'] })).toThrow(
      'mz.update: "items.status" goes through an array: mz.update takes paths outside arrays'
    )
    // @ts-expect-error an index
    expect(() => update(noteSchema, { $set: ['items.0.status'] })).toThrow(
      '"items.0.status" names an element of an array'
    )
    // @ts-expect-error a positional operator
    expect(() => update(noteSchema, { $set: ['items.$[].status'] })).toThrow(
      '"items.$[].status" names an element of an array'
    )
  })
})

test('the router passes it to the model, which validates it again', async () => {
  const NotesModel = mongozod({ collection: 'notes', db, schema: noteSchema })
  const { document } = await NotesModel.insertOne({
    color: 'red',
    content: 'Milk',
    title: 'Groceries'
  })
  const input = notesUpdate.parse({
    $inc: { views: 2 },
    $set: { title: 'Shopping' },
    $unset: { color: '' }
  })

  await NotesModel.updateOne({ _id: document._id }, input)

  expect(await NotesModel.findOne({ _id: document._id })).toEqual({
    _id: document._id,
    content: 'Milk',
    items: [],
    title: 'Shopping',
    views: 2
  })
})
