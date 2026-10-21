import type { Db } from 'mongodb'

import { MongoClient, MongoServerError } from 'mongodb'
import { afterAll, beforeAll, expect, inject, test } from 'vitest'
import { z } from 'zod'

import { mongozod } from '../mongozod'

import { autoIndex } from './auto-index'

const client = new MongoClient(inject('mongoUri'), { monitorCommands: true })

beforeAll(() => client.connect())
afterAll(() => client.close())

let databases = 0

/** A fresh database: the plugin remembers the builds of each one it sees. */
async function freshDb() {
  const db = client.db(`mongozod-auto-index-${databases++}`)

  await db.dropDatabase()

  return db
}

/** Counts the `createIndexes` commands sent to a database while `run` runs. */
async function createIndexesSent(db: Db, run: () => Promise<unknown>) {
  let sent = 0
  const count = (event: { commandName: string; databaseName: string }) => {
    if (event.commandName === 'createIndexes' && event.databaseName === db.databaseName) sent++
  }

  client.on('commandStarted', count)

  try {
    await run()
  } finally {
    client.off('commandStarted', count)
  }

  return sent
}

const usageSchema = z.object({ count: z.number().int(), organization: z.string() })

function usagesModel(db: Db | (() => Db)) {
  return mongozod({
    collection: 'usages',
    db,
    indexes: (index) => [index({ organization: 1 }, { unique: true })],
    plugins: [autoIndex()],
    schema: usageSchema
  })
}

test('creates the indexes once, before the first operations, which then rely on them', async () => {
  const db = await freshDb()
  const UsagesModel = usagesModel(db)

  // Without the unique index, concurrent upserts on an existing collection insert several.
  await db.createCollection('usages')

  const sent = await createIndexesSent(db, () =>
    Promise.all(
      Array.from({ length: 50 }, () =>
        UsagesModel.updateOne(
          { organization: 'acme' },
          { $inc: { count: 1 } },
          { upsert: true }
        ).catch((error: unknown) => {
          // Two upserts can race to insert: the unique index rejects one, as MongoDB documents.
          if (!(error instanceof MongoServerError && error.code === 11_000)) throw error
        })
      )
    )
  )

  expect(sent).toBe(1)
  expect(await UsagesModel.countDocuments({ organization: 'acme' })).toBe(1)
  expect(await createIndexesSent(db, () => UsagesModel.find({}).toArray())).toBe(0)
})

test('builds them in each database a model reads, such as a tenant', async () => {
  const [acme, globex] = await Promise.all([freshDb(), freshDb()])
  let current = acme
  const UsagesModel = usagesModel(() => current)

  await UsagesModel.insertOne({ count: 1, organization: 'acme' })
  current = globex
  await UsagesModel.find({ organization: 'acme' })

  expect(await acme.collection('usages').indexExists('organization_1')).toBe(true)
  expect(await globex.collection('usages').indexExists('organization_1')).toBe(true)
})

test('a failed build fails the operation, and the next one tries again', async () => {
  const db = await freshDb()
  const UsagesModel = usagesModel(db)

  await db.collection('usages').insertMany([
    { count: 1, organization: 'acme' },
    { count: 2, organization: 'acme' }
  ])

  await expect(UsagesModel.countDocuments({})).rejects.toMatchObject({ code: 11_000 })
  await db.collection('usages').deleteOne({ count: 2 })

  expect(await createIndexesSent(db, () => UsagesModel.countDocuments({}))).toBe(1)
  expect(await db.collection('usages').indexExists('organization_1')).toBe(true)
})

test('a model without indexes sends nothing', async () => {
  const db = await freshDb()
  const NotesModel = mongozod({
    collection: 'notes',
    db,
    plugins: [autoIndex()],
    schema: z.object({ title: z.string() })
  })

  expect(await createIndexesSent(db, () => NotesModel.insertOne({ title: 'A' }))).toBe(0)
})
