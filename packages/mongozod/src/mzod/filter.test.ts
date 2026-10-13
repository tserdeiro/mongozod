import { BSONRegExp, MongoClient } from 'mongodb'
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
import * as zm from 'zod/mini'

import { mongozod } from '../mongozod'

import { filter } from './filter'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-mz-filter')

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
  charge: z.object({ feature: z.string() }).optional(),
  createdAt: dateSchema.default(() => new Date()),
  items: z.array(z.object({ amount: z.number(), status: z.enum(['open', 'paid']) })).default([]),
  pinned: z.boolean().default(false),
  scores: z.array(z.number()).default([]),
  tags: z.array(z.string()).default([]),
  title: z.string().min(1)
})

const notesFilter = filter(noteSchema, {
  '_id': ['$eq', '$in'],
  'charge.feature': ['$eq', '$in'],
  'createdAt': ['$gte', '$lt'],
  'items': ['$elemMatch', '$size'],
  'items.amount': ['$gt'],
  'items.status': ['$eq'],
  'scores': ['$elemMatch', '$gte', '$lt'],
  'tags': ['$all', '$eq'],
  'title': ['$eq', '$exists', '$regex']
})

const id = '0c7e5f2a-1b2c-4d3e-8f90-123456789abc'

function issues(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value)

  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
}

describe('a filter from a client', () => {
  test('takes MongoDB syntax with the declared operators, and parses each value', () => {
    expect(notesFilter.parse({ _id: id, title: { $exists: true } })).toEqual({
      _id: id,
      title: { $exists: true }
    })
    expect(notesFilter.parse({ 'charge.feature': { $in: ['ai'] } })).toEqual({
      'charge.feature': { $in: ['ai'] }
    })
    expect(notesFilter.parse({ title: { $options: 'i', $regex: '^gro' } })).toEqual({
      title: { $options: 'i', $regex: '^gro' }
    })
    expect(notesFilter.parse({ createdAt: { $gte: '2026-10-01T00:00:00Z' } })).toEqual({
      createdAt: { $gte: new Date('2026-10-01T00:00:00Z') }
    })
  })

  test('rejects what is not declared, and values their field does not take', () => {
    expect(issues(notesFilter, { $where: 'sleep(1000)' })).toEqual([': Unrecognized key: "$where"'])
    expect(issues(notesFilter, { $or: [{ title: 'a' }] })).toEqual([': Unrecognized key: "$or"'])
    expect(issues(notesFilter, { pinned: true })).toEqual([': Unrecognized key: "pinned"'])
    expect(issues(notesFilter, { title: { $where: 'x' } })).toEqual([
      'title: Unrecognized key: "$where"'
    ])
    expect(issues(notesFilter, { createdAt: '2026-10-01T00:00:00Z' })).toHaveLength(1)
    expect(issues(notesFilter, { _id: 'not-a-uuid' })).toEqual(['_id: Invalid UUID'])
    expect(issues(notesFilter, { title: '' })).toHaveLength(1)
  })

  test('an object of operators takes at least one, and undefined keys are dropped', () => {
    expect(issues(notesFilter, { title: {} })).toEqual(['title: takes at least one operator'])
    expect(
      notesFilter.parse({
        createdAt: { $gte: '2026-10-01T00:00:00Z', $lt: undefined },
        title: undefined
      })
    ).toEqual({ createdAt: { $gte: new Date('2026-10-01T00:00:00Z') } })
    expect(issues(notesFilter, { createdAt: { $lt: undefined } })).toEqual([
      'createdAt: takes at least one operator'
    ])
  })

  test('$options goes with $regex, which MongoDB needs', async () => {
    await expect(
      db.collection('notes').findOne({ title: { $options: 'i' } })
    ).rejects.toMatchObject({ code: 2, message: '$options needs a $regex' })
    expect(issues(notesFilter, { title: { $options: 'i' } })).toEqual([
      'title.$options: "$options" needs "$regex"'
    ])
    expect(issues(notesFilter, { title: { $options: 'i', $regex: undefined } })).toEqual([
      'title.$options: "$options" needs "$regex"'
    ])
    expect(issues(notesFilter, { title: { $options: 1 } })).toHaveLength(1)
  })

  test('$options takes the flags MongoDB takes, which rejects the others', async () => {
    await expect(
      db.collection('notes').findOne({ title: { $options: 'g', $regex: 'a' } })
    ).rejects.toMatchObject({ code: 51108 })
    expect(notesFilter.parse({ title: { $options: 'imxsu', $regex: 'a' } })).toEqual({
      title: { $options: 'imxsu', $regex: 'a' }
    })
    expect(issues(notesFilter, { title: { $options: 'g', $regex: 'a' } })).toEqual([
      'title.$options: "$options" takes the flags i, m, x, s and u'
    ])
  })

  test('on arrays, an element or the array, $all, $size and $elemMatch', () => {
    expect(notesFilter.parse({ tags: 'a' })).toEqual({ tags: 'a' })
    expect(notesFilter.parse({ tags: ['a', 'b'] })).toEqual({ tags: ['a', 'b'] })
    expect(notesFilter.parse({ items: { $size: 0 }, tags: { $all: ['a'] } })).toEqual({
      items: { $size: 0 },
      tags: { $all: ['a'] }
    })
    expect(
      notesFilter.parse({
        items: { $elemMatch: { amount: { $gt: 5 }, status: 'paid' } },
        scores: { $elemMatch: { $gte: 80, $lt: 90 } }
      })
    ).toEqual({
      items: { $elemMatch: { amount: { $gt: 5 }, status: 'paid' } },
      scores: { $elemMatch: { $gte: 80, $lt: 90 } }
    })
    expect(issues(notesFilter, { items: { $elemMatch: { pinned: true } } })).toEqual([
      'items.$elemMatch: Unrecognized key: "pinned"'
    ])
    expect(issues(notesFilter, { scores: { $elemMatch: { $exists: true } } })).toEqual([
      'scores.$elemMatch: Unrecognized key: "$exists"'
    ])
  })
})

test('a value with keys that start with $ fails, even where the field takes any object', async () => {
  const eventSchema = z.object({
    data: z.unknown(),
    labels: z.record(z.string(), z.string()),
    meta: z.looseObject({ source: z.string() }),
    steps: z.array(z.unknown())
  })
  const eventsFilter = filter(eventSchema, {
    data: ['$eq', '$in', '$ne'],
    labels: ['$eq'],
    meta: ['$eq'],
    steps: ['$all']
  })
  const message = 'a value cannot have keys that start with "$", which MongoDB reads as operators'

  // MongoDB reads them as operators in an equality and in $all, so a client would get any of them.
  await db.collection('events').insertMany([{ labels: { team: 'ads' } }, { labels: {} }])
  expect(await db.collection('events').countDocuments({ labels: { $ne: null } })).toBe(2)

  expect(
    [
      { labels: { $ne: null } },
      { meta: { $exists: true, source: 'web' } },
      { data: { $where: 'sleep(1000)' } },
      { data: { $in: [{ $ne: null }] } },
      { data: { $ne: { $ne: null } } },
      { steps: { $all: [{ $elemMatch: { $exists: true } }] } }
    ].map((value) => issues(eventsFilter, value).join(', '))
  ).toEqual([
    'labels: Unrecognized key: "$ne"',
    'meta: Unrecognized keys: "$exists", "source"',
    'data: Unrecognized key: "$where"',
    `data.$in.0: ${message}`,
    `data.$ne: ${message}`,
    `steps.$all.0: ${message}`
  ])

  // An object without them is still a value, at any depth.
  expect(eventsFilter.parse({ data: { step: { $ne: 1 } }, labels: { team: 'ads' } })).toEqual({
    data: { step: { $ne: 1 } },
    labels: { team: 'ads' }
  })

  // A transform can build one out of a string: the check runs on what the schema returns too.
  const parsedFilter = filter(
    z.object({ payload: z.string().transform((json): unknown => JSON.parse(json)) }),
    { payload: ['$eq', '$in'] }
  )

  expect(parsedFilter.parse({ payload: '{"step":1}' })).toEqual({ payload: { step: 1 } })
  expect(issues(parsedFilter, { payload: '{"$ne":null}' })).toEqual([`payload: ${message}`])
  expect(issues(parsedFilter, { payload: { $in: ['{"$ne":null}'] } })).toEqual([
    `payload.$in.0: ${message}`
  ])
})

test('a regular expression fails as a value, which MongoDB would match as a pattern', async () => {
  const message =
    'a value cannot be a regular expression, which MongoDB matches as a pattern: declare "$regex"'
  const eventsFilter = filter(
    z.object({
      data: z.unknown(),
      pattern: z.string().transform((source) => new RegExp(source))
    }),
    { data: ['$eq', '$in'], pattern: ['$eq'] }
  )

  // The driver sends it as a regex, which matches every string.
  await db.collection('events').insertMany([{ data: 'alpha' }, { data: 'beta' }])
  expect(await db.collection('events').countDocuments({ data: /./ })).toBe(2)

  // A transport such as superjson sends one, and a transform can build one.
  expect(issues(eventsFilter, { data: /./ })).toEqual([`data: ${message}`])
  expect(issues(eventsFilter, { data: { $in: [new BSONRegExp('.')] } })).toEqual([
    `data.$in.0: ${message}`
  ])
  expect(issues(eventsFilter, { pattern: '.' })).toEqual([`pattern: ${message}`])
  expect(eventsFilter.parse({ data: { source: '.' } })).toEqual({ data: { source: '.' } })
})

test('takes Zod Mini schemas, and a discriminated union finds each field in its types', () => {
  const miniFilter = filter(zm.object({ _id: zm.string(), views: zm.optional(zm.number()) }), {
    views: ['$gte']
  })
  const paymentFilter = filter(
    z.discriminatedUnion('method', [
      z.object({ _id: z.string(), last4: z.string().length(4), method: z.literal('card') }),
      z.object({ _id: z.string(), cbu: z.string(), method: z.literal('transfer') })
    ]),
    { last4: ['$eq'], method: ['$eq'] }
  )

  expect(miniFilter.parse({ views: { $gte: 1 } })).toEqual({ views: { $gte: 1 } })
  expect(paymentFilter.parse({ last4: '4242', method: 'card' })).toEqual({
    last4: '4242',
    method: 'card'
  })
  expect(issues(paymentFilter, { method: 'cash' })).toHaveLength(1)
  expectTypeOf<z.input<typeof paymentFilter>['method']>().toEqualTypeOf<
    'card' | 'transfer' | { $eq?: 'card' | 'transfer' } | undefined
  >()
})

describe('the project decides with Zod', () => {
  test('what an absent filter means: a default, required fields or at least one field', () => {
    const list = z.object({ filter: notesFilter.default({}) })
    const byId = filter(noteSchema, { _id: ['$eq'] }).required({ _id: true })
    const findOne = filter(noteSchema, { _id: ['$eq'], title: ['$eq'] }).refine(
      (value) => Object.keys(value).length > 0,
      'pass at least one field'
    )

    expect(list.parse({})).toEqual({ filter: {} })
    // The `_id` has a default, which a filter never fills: a fresh uuid would match nothing.
    expect(issues(byId, {})).toEqual([
      '_id: Invalid input: expected nonoptional, received undefined'
    ])
    expect(issues(byId, { _id: undefined })).toHaveLength(1)
    expect(issues(findOne, {})).toEqual([': pass at least one field'])
    expect(findOne.parse({ title: 'Groceries' })).toEqual({ title: 'Groceries' })

    expectTypeOf<z.input<typeof list>>().toEqualTypeOf<{
      filter?: z.input<typeof notesFilter> | undefined
    }>()
    expectTypeOf<z.input<typeof byId>>().toEqualTypeOf<{
      _id: string | { $eq?: string }
    }>()
  })

  test('$and, $or and $nor, nesting the same whitelist', () => {
    const fields = filter(noteSchema, { tags: ['$eq'], title: ['$eq'] })
    const audience = fields.extend({
      get $or() {
        return z.array(audience).optional()
      }
    })

    expect(audience.parse({ $or: [{ title: 'a' }, { $or: [{ tags: 'b' }] }] })).toEqual({
      $or: [{ title: 'a' }, { $or: [{ tags: 'b' }] }]
    })
    expect(issues(audience, { $or: [{ pinned: true }] })).toEqual([
      '$or.0: Unrecognized key: "pinned"'
    ])
  })
})

describe('the declarations', () => {
  test('a path or an operator that does not exist does not compile and throws', () => {
    // @ts-expect-error not a path of the document
    expect(() => filter(noteSchema, { titel: ['$eq'] })).toThrow(
      'mz.filter: "titel" is not a path of the document'
    )
    // @ts-expect-error $where is not an operator of mz.filter
    expect(() => filter(noteSchema, { title: ['$where'] })).toThrow(
      'mz.filter: "$where" is not an operator of mz.filter'
    )
  })

  test('an operator that does not apply to the field does not compile', () => {
    // @ts-expect-error $size only applies to arrays
    expect(() => filter(noteSchema, { title: ['$size'] })).toThrow(
      'mz.filter: "$size" only applies to arrays, and "title" is not one'
    )
    // @ts-expect-error $elemMatch on objects needs paths declared under the array
    expect(() => filter(noteSchema, { items: ['$elemMatch'] })).toThrow(
      'mz.filter: "$elemMatch" on "items" needs operators for its elements, or paths declared under it'
    )
    // @ts-expect-error $elemMatch on values needs operators for the elements
    expect(() => filter(noteSchema, { scores: ['$elemMatch'] })).toThrow('"$elemMatch" on "scores"')

    // The runtime validates their values with the field's schema all the same.
    expectTypeOf(() => {
      // @ts-expect-error $regex only applies to strings
      filter(noteSchema, { createdAt: ['$regex'] })
      // @ts-expect-error $gt does not compare booleans
      filter(noteSchema, { pinned: ['$gt'] })
    }).toBeFunction()
  })

  test('the types of what the client sends and what the router gets', () => {
    type Input = z.input<typeof notesFilter>
    type Output = z.output<typeof notesFilter>

    expectTypeOf<Input['createdAt']>().toEqualTypeOf<
      { $gte?: string | Date; $lt?: string | Date } | undefined
    >()
    expectTypeOf<Output['createdAt']>().toEqualTypeOf<{ $gte?: Date; $lt?: Date } | undefined>()
    expectTypeOf<Output['tags']>().toEqualTypeOf<
      string | string[] | { $all?: string[]; $eq?: string | string[] } | undefined
    >()
  })
})

test('the router passes it to the model, which checks it against the schema', async () => {
  const NotesModel = mongozod({ collection: 'notes', db, schema: noteSchema })

  await NotesModel.insertMany([
    {
      _id: id,
      createdAt: new Date('2026-10-02'),
      items: [{ amount: 9, status: 'paid' }],
      title: 'A'
    },
    { createdAt: new Date('2026-09-01'), items: [{ amount: 9, status: 'open' }], title: 'B' }
  ])

  const input = notesFilter.parse({
    createdAt: { $gte: '2026-10-01T00:00:00Z' },
    items: { $elemMatch: { amount: { $gt: 5 }, status: 'paid' } }
  })

  expect(await NotesModel.find({ $and: [input, { title: { $exists: true } }] })).toMatchObject([
    { _id: id }
  ])
})
