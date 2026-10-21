import type {
  BulkWriteOf,
  FilterOf,
  FindOptionsOf,
  InsertOf,
  ReadOf,
  SortOf,
  UpdateOf,
  UpdateOptionsArg
} from './model'

import { MongoClient } from 'mongodb'
import { expect, expectTypeOf, test } from 'vitest'
import { z } from 'zod'

import { mongozod } from '../mongozod'
import { date } from '../mzod/fields/date'
import { populate } from '../mzod/populate'
import { projection } from '../mzod/projection'
import { sort as sortInput } from '../mzod/sort'
import { softDelete } from '../plugins/soft-delete'

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
  schema: z.object({ author: z.string(), createdAt: date(), title: z.string(), updatedAt: date() }),
  timestamps: true
})

const TasksModel = mongozod({
  collection: 'tasks',
  db,
  plugins: [softDelete()],
  schema: z.object({
    createdAt: date(),
    deletedAt: z.date().optional(),
    title: z.string(),
    updatedAt: date()
  }),
  timestamps: true
})

/** A service that takes a filter and an update of the posts, as a router would. */
function updatePosts<
  const F extends FilterOf<typeof PostsModel, F>,
  const U extends UpdateOf<typeof PostsModel, U, F>
>(filter: F, update: U) {
  return PostsModel.updateMany(filter, update)
}

/** The same for a model with plugins, whose types are deeper. */
function updateTasks<
  const F extends FilterOf<typeof TasksModel, F>,
  const U extends UpdateOf<typeof TasksModel, U, F>
>(filter: F, update: U) {
  return TasksModel.updateMany(filter, update)
}

/** A service that takes a sort of the posts and passes it to the model. */
function sortPosts<const Sort extends SortOf<typeof PostsModel, Sort>>(sort: Sort) {
  return [
    PostsModel.find({}, { sort }),
    PostsModel.findOne({}, { sort }),
    // oxlint-disable-next-line unicorn/no-array-sort -- the sort of a cursor, not of an array
    PostsModel.find({}).sort(sort)
  ]
}

test('SortOf passes a sort to the options of a read and to its cursor', () => {
  expect(() => {
    void sortPosts({ createdAt: -1, title: 1 })
    // @ts-expect-error "titel" is not a path of the document
    void sortPosts({ titel: 1 })
  }).toBeTypeOf('function')
})

/** Services that pass the options of an update on, such as its session. */
function publishPosts(...options: UpdateOptionsArg<typeof PostsModel>) {
  return PostsModel.updateMany({ title: 'Draft' }, { $set: { title: 'Final' } }, ...options)
}

function finishTasks(...options: UpdateOptionsArg<typeof TasksModel>) {
  return TasksModel.updateMany({ title: 'Draft' }, { $set: { title: 'Done' } }, ...options)
}

test('UpdateOptionsArg passes the options of an update on', () => {
  expect(() => {
    void publishPosts({ upsert: false })
    void finishTasks()
  }).toBeTypeOf('function')
})

test('UpdateOf passes an update to a model with timestamps, references and plugins', () => {
  expect(() => {
    void updatePosts({ title: 'Draft' }, { $set: { title: 'Final' } })
    void updateTasks({ title: 'Draft' }, { $set: { title: 'Final' } })
    // @ts-expect-error updatedAt is set by timestamps
    void updatePosts({}, { $set: { updatedAt: new Date() } })
    // @ts-expect-error updatedAt is set by timestamps
    void updateTasks({}, { $set: { updatedAt: new Date() } })
  }).toBeTypeOf('function')
})

test('ReadOf is the document a read returns, with its projection and its populate', () => {
  const readPost = () =>
    PostsModel.findOne(
      {},
      { populate: { author: { projection: { name: 1 } } }, projection: { author: 1, title: 1 } }
    )
  const readTask = () => TasksModel.findOne({})

  expectTypeOf<
    ReadOf<
      typeof PostsModel,
      { populate: { author: { projection: { name: 1 } } }; projection: { author: 1; title: 1 } }
    >
  >().toEqualTypeOf<NonNullable<Awaited<ReturnType<typeof readPost>>>>()
  expectTypeOf<ReadOf<typeof TasksModel>>().toEqualTypeOf<
    NonNullable<Awaited<ReturnType<typeof readTask>>>
  >()
})

test('ReadOf takes options from an input, whose populate and projection may be undefined', () => {
  const input = z.object({
    populate: populate({ author: z.object({ _id: z.string(), name: z.string() }) }),
    projection: projection(PostsModel.schema, { author: true, title: true })
  })

  type Options = z.output<typeof input>

  const read = (options: Options) => PostsModel.findOne({}, options)
  const readPopulated = (options: Pick<Options, 'populate'>) => PostsModel.findOne({}, options)
  const update = (options: Pick<Options, 'populate'>) =>
    PostsModel.findOneAndUpdate({}, { $set: { title: 'Final' } }, options)

  expectTypeOf<ReadOf<typeof PostsModel, Options>>().toEqualTypeOf<
    NonNullable<Awaited<ReturnType<typeof read>>>
  >()
  expectTypeOf<ReadOf<typeof PostsModel, Pick<Options, 'populate'>>>().toEqualTypeOf<
    NonNullable<Awaited<ReturnType<typeof readPopulated>>>
  >()
  expectTypeOf<ReadOf<typeof PostsModel, Pick<Options, 'populate'>>>().toEqualTypeOf<
    NonNullable<Awaited<ReturnType<typeof update>>>
  >()
  expectTypeOf<
    ReadOf<typeof PostsModel, Pick<Options, 'populate'>>['author']
  >().not.toEqualTypeOf<string>()
  expectTypeOf<
    ReadOf<typeof PostsModel, { populate?: undefined; projection?: undefined }>
  >().toEqualTypeOf<ReadOf<typeof PostsModel>>()
})

test('FindOptionsOf types the options a service takes from a router, without the router', () => {
  const listPostsInput = z.object({
    populate: populate({ author: z.object({ _id: z.string(), name: z.string() }) }),
    sort: sortInput(PostsModel.schema, { createdAt: true, title: true })
  })

  type Options = FindOptionsOf<typeof PostsModel>

  /** A service: the router passes its input, and the server its own sort and limit. */
  const postsService = {
    list<const F extends FilterOf<typeof PostsModel, F>>(filter: F, options: Options = {}) {
      return PostsModel.find(filter, options)
    },
    findOne<const F extends FilterOf<typeof PostsModel, F>>(filter: F, options: Options = {}) {
      return PostsModel.findOne(filter, options)
    }
  }

  const input = listPostsInput.parse({})

  expect(() => {
    void postsService.list({}, { limit: 20, populate: input.populate, skip: 0, sort: input.sort })
    void postsService.list({ title: 'Draft' }, { maxTimeMS: 1000, sort: { updatedAt: 1 } })
    void postsService.findOne({}, { populate: { author: { projection: { name: 1 } } } })
    // @ts-expect-error "titel" is not a path of the document
    void postsService.list({}, { sort: { titel: 1 } })
    // @ts-expect-error "editor" is not a reference of the model
    void postsService.list({}, { populate: { editor: { projection: { name: 1 } } } })
  }).toBeTypeOf('function')

  type Found = NonNullable<Awaited<ReturnType<typeof postsService.findOne>>>

  expectTypeOf<Found['author']>().toEqualTypeOf<string | { _id?: string; name?: string } | null>()
  expectTypeOf<FindOptionsOf<typeof UsersModel>>().not.toHaveProperty('populate')
  expectTypeOf<FindOptionsOf<typeof TasksModel>>().toHaveProperty('sort')
})

/** A service that takes the operations of a bulkWrite that a router builds. */
function writePosts<const Ops extends BulkWriteOf<typeof PostsModel, Ops>>(operations: Ops) {
  return PostsModel.bulkWrite(operations)
}

/** The same for a model with plugins. */
function writeTasks<const Ops extends BulkWriteOf<typeof TasksModel, Ops>>(operations: Ops) {
  return TasksModel.bulkWrite(operations)
}

test('BulkWriteOf passes operations built elsewhere to the model, each checked', () => {
  const titles = ['One', 'Two']

  expect(() => {
    void writePosts([
      { insertOne: { document: { author: 'ada', title: 'One' } } },
      {
        updateOne: { filter: { title: 'One' }, update: { $set: { title: 'Final' } }, upsert: true }
      }
    ])
    void writePosts(
      titles.map((title) => ({
        updateOne: { filter: { title }, update: { $set: { author: 'ada' } } }
      }))
    )
    void writeTasks([{ deleteOne: { filter: { title: 'Done' } } }])
    // @ts-expect-error "titel" is not a path of the document
    void writePosts([{ deleteOne: { filter: { titel: 'One' } } }])
    // @ts-expect-error updatedAt is set by timestamps
    void writePosts([{ updateOne: { filter: {}, update: { $set: { updatedAt: new Date() } } } }])
  }).toBeTypeOf('function')
})

test('InsertOf is what an insert takes, without the fields timestamps and plugins fill', () => {
  /** A service that builds a post and inserts it. */
  function createPost(post: InsertOf<typeof PostsModel>) {
    return PostsModel.insertOne(post)
  }

  expectTypeOf<InsertOf<typeof PostsModel>>().toEqualTypeOf<{
    author: string
    createdAt?: string | Date
    title: string
    updatedAt?: string | Date
  }>()
  expectTypeOf<InsertOf<typeof UsersModel>>().toEqualTypeOf<{ _id: string; name: string }>()
  expect(createPost).toBeTypeOf('function')
})
