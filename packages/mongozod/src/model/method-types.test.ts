import type {
  AggregateMethod,
  BulkWriteMethod,
  DistinctMethod,
  FilterMethod,
  ReplaceMethod,
  UpdateMethod
} from './method-types'
import type { ReadOf } from './model'
import type { CountDocumentsOptions } from 'mongodb'

import { MongoClient } from 'mongodb'
import { expect, expectTypeOf, test } from 'vitest'
import { z } from 'zod'

import { mongozod } from '../mongozod'
import { date } from '../mzod/fields/date'

const db = new MongoClient('mongodb://localhost').db()

const UsersModel = mongozod({
  collection: 'users',
  db,
  schema: z.object({ _id: z.string(), name: z.string() })
})

const PostsModel = mongozod({
  collection: 'posts',
  db,
  references: { author: () => UsersModel },
  schema: z.object({
    author: z.string(),
    createdAt: date(),
    links: z.object({ checked: z.boolean(), url: z.string() }).array(),
    status: z.enum(['draft', 'published']),
    title: z.string(),
    updatedAt: date()
  }),
  timestamps: true
})

type Posts = typeof PostsModel

const after = { returnDocument: 'after' } as const

/** A service whose methods take their type parameters from `satisfies`. */
const postsService = {
  aggregate: (pipeline) => PostsModel.aggregate(pipeline),
  count: (filter, options?) => PostsModel.countDocuments(filter, options),
  distinct: (key, filter?) => PostsModel.distinct(key, filter),
  list: (filter, options = {}) => PostsModel.find(filter, options),
  replaceOne: (filter, replacement) => PostsModel.replaceOne(filter, replacement),
  updateMany: (filter, update, options?) => PostsModel.updateMany(filter, update, options),
  updateOne: (filter, update) => PostsModel.findOneAndUpdate(filter, update, after),
  write: (operations) => PostsModel.bulkWrite(operations)
} satisfies {
  aggregate: AggregateMethod<Posts>
  count: FilterMethod<Posts, CountDocumentsOptions>
  distinct: DistinctMethod<Posts>
  list: FilterMethod<Posts>
  replaceOne: ReplaceMethod<Posts>
  updateMany: UpdateMethod<Posts>
  updateOne: UpdateMethod<Posts, typeof after>
  write: BulkWriteMethod<Posts>
}

/** A function on its own, and a class with arrow properties, take them the same way. */
const listPosts = ((filter, options = {}) =>
  PostsModel.find(filter, options)) satisfies FilterMethod<Posts>

class PostsService {
  list = ((filter, options = {}) => PostsModel.find(filter, options)) satisfies FilterMethod<Posts>
}

test('a method typed with satisfies checks what it passes to the model', () => {
  const setChecked = { $set: { 'links.$[link].checked': true } } as const

  expect(() => {
    void postsService.list({ status: 'draft' }, { limit: 20, sort: { createdAt: -1 } })
    void postsService.count({ status: 'draft' }, { limit: 1 })
    void postsService.updateOne({ title: 'One' }, { $set: { status: 'published' } })
    void postsService.updateMany({}, setChecked, { arrayFilters: [{ 'link.url': 'https://a.b' }] })
    void postsService.replaceOne(
      { title: 'One' },
      { author: 'ada', links: [], status: 'draft', title: 'Two' }
    )
    void postsService.write([{ deleteMany: { filter: { status: 'draft' } } }])
    void postsService.aggregate([{ $match: { status: 'published' } }])
    void postsService.distinct('status', { title: 'One' })
    void listPosts({ status: 'draft' })
    void new PostsService().list({ status: 'draft' })
    // @ts-expect-error "titel" is not a path of the document
    void postsService.list({ titel: 'One' })
    // @ts-expect-error a status is 'draft' or 'published'
    void postsService.updateOne({}, { $set: { status: 'archived' } })
    // @ts-expect-error "links.$[link].checked" uses an identifier: pass arrayFilters
    void postsService.updateMany({}, setChecked)
    // @ts-expect-error the method passes its own options
    void postsService.updateOne({}, { $set: { title: 'Two' } }, { upsert: true })
    // @ts-expect-error title is required
    void postsService.replaceOne({}, { author: 'ada', links: [], status: 'draft' })
    // @ts-expect-error "titel" is not a path of the document
    void postsService.write([{ deleteOne: { filter: { titel: 'One' } } }])
    // @ts-expect-error a status is 'draft' or 'published'
    void postsService.aggregate([{ $match: { status: 'archived' } }])
    // @ts-expect-error "titel" is not a path of the document
    void postsService.distinct('titel')
    // @ts-expect-error "titel" is not a path of the document
    void listPosts({ titel: 'One' })
    // @ts-expect-error "titel" is not a path of the document
    void new PostsService().list({ titel: 'One' })
  }).toBeTypeOf('function')
})

const listDrafts = () => postsService.list({ status: 'draft' })
const renameOne = () => postsService.updateOne({ title: 'One' }, { $set: { title: 'Two' } })
const statuses = () => postsService.distinct('status')

test('the result is the method own, inferred from what it returns', () => {
  expectTypeOf<Awaited<ReturnType<typeof listDrafts>>[number]['title']>().toEqualTypeOf<string>()
  expectTypeOf<Awaited<ReturnType<typeof renameOne>>>().toEqualTypeOf<ReadOf<Posts> | null>()
  expectTypeOf<Awaited<ReturnType<typeof statuses>>>().toEqualTypeOf<Array<'draft' | 'published'>>()
})
