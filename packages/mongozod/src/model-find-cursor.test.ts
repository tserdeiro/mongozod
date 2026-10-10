import type { WithId } from 'mongodb'

import { MongoClient } from 'mongodb'
import { afterAll, beforeAll, expect, expectTypeOf, inject, test } from 'vitest'
import { z } from 'zod'

import { mongozod } from './mongozod'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-find-cursor')

const noteSchema = z.object({
  _id: z.uuidv4().default(() => crypto.randomUUID()),
  position: z.number().int(),
  title: z.string()
})

const NotesModel = mongozod({ collection: 'notes', db, schema: noteSchema })

beforeAll(async () => {
  await client.connect()
  await db.dropDatabase()
  await NotesModel.insertMany(
    Array.from({ length: 5 }, (_, position) => ({ position, title: `Note ${position}` }))
  )
})

afterAll(() => client.close())

test('awaits the array of documents', async () => {
  const notes = await NotesModel.find({ position: { $gte: 3 } })

  expect(notes.map((note) => note.position).toSorted((a, b) => a - b)).toEqual([3, 4])
  expectTypeOf(notes).toEqualTypeOf<Array<WithId<z.output<typeof noteSchema>>>>()
})

test('iterates with for await', async () => {
  const positions: number[] = []

  for await (const note of NotesModel.find({}, { batchSize: 2 })) positions.push(note.position)

  expect(positions.toSorted((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
})

test('chains sort, skip, limit and project like the driver', async () => {
  const notes = await NotesModel.find()
    .sort({ position: -1 })
    .skip(1)
    .limit(2)
    .project({ _id: 0, title: 1 })

  expect(notes).toEqual([{ title: 'Note 3' }, { title: 'Note 2' }])
  expectTypeOf(notes).toEqualTypeOf<Array<{ title: string }>>()
})

test('gives the same array with toArray', async () => {
  const cursor = NotesModel.find().sort({ position: 1 }).limit(1)

  expect(await cursor.toArray()).toEqual([expect.objectContaining({ position: 0 })])
})
