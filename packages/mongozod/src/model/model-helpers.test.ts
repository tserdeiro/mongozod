import type { FilterOf, UpdateOf } from './model'

import { MongoClient } from 'mongodb'
import { expect, test } from 'vitest'
import { z } from 'zod'

import { mongozod } from '../mongozod'
import { date } from '../mzod/fields/date'
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
