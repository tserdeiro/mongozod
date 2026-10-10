import { MongoClient } from 'mongodb'
import { afterAll, beforeAll, beforeEach, expect, expectTypeOf, inject, test } from 'vitest'
import { z } from 'zod'

import { mongozod } from '../mongozod'

import { projection } from './projection'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-mz-projection')

beforeAll(() => client.connect())
afterAll(() => client.close())
beforeEach(() => db.dropDatabase())

const noteSchema = z.object({
  _id: z.string(),
  content: z.string(),
  owner: z.object({ email: z.string(), name: z.string() }),
  title: z.string()
})

const notesProjection = projection(noteSchema, {
  '_id': true,
  'content': true,
  'owner.name': true,
  'title': true
})

test('includes or excludes the declared paths, without mixing both but for _id', () => {
  expect(notesProjection.parse({ _id: 0, content: 1, title: true })).toEqual({
    _id: 0,
    content: 1,
    title: true
  })
  expect(notesProjection.parse({ 'content': false, 'owner.name': 0 })).toEqual({
    'content': false,
    'owner.name': 0
  })
  expect(notesProjection.safeParse({ content: 0, title: 1 }).error?.issues).toMatchObject([
    { message: 'a projection cannot mix inclusion and exclusion, except for _id' }
  ])
  expect(notesProjection.safeParse({ owner: 1 }).success).toBe(false)
  expect(notesProjection.safeParse({ title: { $slice: 1 } }).success).toBe(false)
})

test('a path that does not exist does not compile and throws', () => {
  // @ts-expect-error not a path of the document
  expect(() => projection(noteSchema, { titel: true })).toThrow(
    'mz.projection: "titel" is not a path of the document'
  )
})

test('the router passes it to the model, which leaves each projected field optional', async () => {
  const NotesModel = mongozod({ collection: 'notes', db, schema: noteSchema })

  await NotesModel.insertOne({
    _id: 'n1',
    content: 'Milk',
    owner: { email: 'ana@example.com', name: 'Ana' },
    title: 'Groceries'
  })

  const input = notesProjection.parse({ 'owner.name': 1, 'title': 1 })
  const note = await NotesModel.findOne({ _id: 'n1' }, { projection: input })

  expect(note).toEqual({ _id: 'n1', owner: { name: 'Ana' }, title: 'Groceries' })
  // The projection may include or exclude owner.name, so both fields of owner may be missing.
  expectTypeOf<NonNullable<typeof note>['owner']>().toEqualTypeOf<
    { email?: string; name?: string } | undefined
  >()
})
