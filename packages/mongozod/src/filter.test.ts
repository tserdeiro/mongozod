import type { ModelFilter } from './filter'

import { ObjectId } from 'mongodb'
import { expect, test } from 'vitest'
import { z } from 'zod'

const noteSchema = z.object({
  _id: z.uuidv4(),
  author: z.object({ name: z.string(), nickname: z.string().optional() }).optional(),
  createdAt: z.date(),
  deletedAt: z.date().optional(),
  location: z.object({ coordinates: z.array(z.number()), type: z.literal('Point') }).optional(),
  metadata: z.record(z.string(), z.number()).optional(),
  pinned: z.boolean(),
  scores: z.array(z.number()).default([]),
  status: z.enum(['draft', 'published']),
  tags: z.array(z.object({ label: z.string(), weight: z.number() })).default([]),
  title: z.string(),
  views: z.number().int()
})

type Note = typeof noteSchema

const eventSchema = z.object({ name: z.string() })

/** Returns the filter as it is: the tests only check what compiles. */
function filter<const F extends ModelFilter<Note, F>>(value?: F) {
  return value
}

function eventFilter<const F extends ModelFilter<typeof eventSchema, F>>(value: F) {
  return value
}

test('equalities and operators on each field', () => {
  filter({ status: 'draft', title: 'Groceries' })
  filter({ title: /groc/i, views: { $gte: 1, $lt: 10 } })
  filter({ createdAt: { $gt: new Date() }, status: { $in: ['draft', 'published'] } })
  filter({ deletedAt: null, title: { $exists: true, $ne: 'x' } })
  filter({ 'author.name': { $regex: '^a', $options: 'i' }, 'views': { $mod: [2, 0] } })
  filter({ title: { $not: /x/ }, views: { $not: { $gt: 3 } } })
  filter({ status: { $type: 'string' }, views: { $bitsAllSet: [0, 1] } })
  filter({ location: { $geoWithin: { $centerSphere: [[0, 0], 1] } } })

  // @ts-expect-error a string field takes a string
  filter({ title: 1 })
  // @ts-expect-error the value of an enum must be one of its options
  filter({ status: 'archived' })
  // @ts-expect-error $regex only applies to strings
  filter({ views: { $regex: '1' } })
  // @ts-expect-error $gt does not compare booleans
  filter({ pinned: { $gt: true } })
  // @ts-expect-error $foo is not a query operator
  filter({ title: { $eq: 'a', $foo: 1 } })
  // @ts-expect-error null only matches fields that can be missing or null
  filter({ title: null })
  expect(true).toBe(true)
})

test('arrays match their elements, and take the array operators', () => {
  filter({ scores: 3, tags: { $size: 2 } })
  filter({ scores: { $all: [1, 2], $gt: 2 } })
  filter({ 'tags.label': 'home', 'tags.0.weight': { $lt: 1 } })
  filter({ tags: { $elemMatch: { label: 'home', weight: { $gte: 1 } } } })
  filter({ scores: { $elemMatch: { $gte: 80, $lt: 85 } } })

  // @ts-expect-error $size only applies to arrays
  filter({ title: { $size: 1 } })
  // @ts-expect-error an element of tags has no "color"
  filter({ tags: { $elemMatch: { color: 'red' } } })
  expect(true).toBe(true)
})

test('paths, records and logical operators', () => {
  filter({ 'metadata.clicks': { $gt: 1 } })
  filter({ $and: [{ status: 'draft' }, { $or: [{ views: 1 }, { 'author.name': 'Ana' }] }] })
  filter({ $expr: { $gt: ['$views', 1] }, $text: { $search: 'milk' } })

  // @ts-expect-error "author.nam" is not a path of the document
  filter({ 'author.nam': 'Ana' })
  // @ts-expect-error a condition inside $or is checked too
  filter({ $or: [{ views: 'many' }] })
  // @ts-expect-error $foo is not a filter operator
  filter({ $foo: 1 })
  expect(true).toBe(true)
})

test('undefined does not compile, and string keys must be literal', () => {
  const organization: string | undefined = undefined
  const key: string = 'title'

  // @ts-expect-error the driver would send undefined as null
  filter({ title: organization })
  // @ts-expect-error a string key could be any path
  filter({ [key]: 'x' })
  expect(true).toBe(true)
})

test('filters composed from other types still check', () => {
  const fromInput: { status?: 'draft' | { $in: Array<'draft' | 'published'> }; title?: string } = {}
  const withOptionalOperators: {
    scores?: { $elemMatch?: { $gte?: number; $lt?: number }; $size?: number }
    title?: { $exists?: boolean; $not?: { $regex?: string } }
  } = {}

  filter({ $and: [fromInput, { views: 1 }] })
  filter(fromInput)
  filter(withOptionalOperators)
  expect(true).toBe(true)
})

test('_id exists even when the schema does not declare it', () => {
  eventFilter({ _id: new ObjectId() })
  // @ts-expect-error the driver's _id is an ObjectId
  eventFilter({ _id: 'a' })
  expect(true).toBe(true)
})
