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

test('turns what the client sends into an inclusion of the declared paths', () => {
  // An inclusion stays as it is, with 1 for each path.
  expect(notesProjection.parse({ _id: 0, content: 1, title: true })).toEqual({
    _id: 0,
    content: 1,
    title: 1
  })
  // An exclusion means the declared paths but those, and nothing means all of them.
  expect(notesProjection.parse({ 'content': false, 'owner.name': 0 })).toEqual({ title: 1 })
  expect(notesProjection.parse({})).toEqual({ 'content': 1, 'owner.name': 1, 'title': 1 })
  // A missing projection gets the same, so the key of an input is optional.
  const listInput = z.object({ projection: notesProjection })

  expect(listInput.parse({})).toEqual({ projection: { 'content': 1, 'owner.name': 1, 'title': 1 } })
  expectTypeOf<z.input<typeof listInput>>().toEqualTypeOf<{
    projection?:
      | Partial<Record<'_id' | 'content' | 'owner.name' | 'title', 0 | 1 | boolean>>
      | undefined
  }>()
  expectTypeOf<z.output<typeof listInput>['projection']>().toEqualTypeOf<
    Partial<Record<'_id' | 'content' | 'owner.name' | 'title', 0 | 1>>
  >()
  expect(notesProjection.parse({ _id: 0 })).toEqual({
    '_id': 0,
    'content': 1,
    'owner.name': 1,
    'title': 1
  })
  // Without a field left, the _id, which MongoDB always returns but for _id: 0.
  expect(notesProjection.parse({ _id: 1 })).toEqual({ _id: 1 })
  expect(notesProjection.parse({ 'content': 0, 'owner.name': 0, 'title': 0 })).toEqual({ _id: 1 })
  expect(
    notesProjection.safeParse({ '_id': 0, 'content': 0, 'owner.name': 0, 'title': 0 }).error?.issues
  ).toMatchObject([{ message: 'a projection cannot exclude every path the endpoint offers' }])
  expect(notesProjection.safeParse({ content: 0, title: 1 }).error?.issues).toMatchObject([
    { message: 'a projection cannot mix inclusion and exclusion, except for _id' }
  ])
  expect(notesProjection.safeParse({ owner: 1 }).success).toBe(false)
  expect(notesProjection.safeParse({ title: { $slice: 1 } }).success).toBe(false)
})

test('a client never gets a field the mask leaves out', async () => {
  const NotesModel = mongozod({ collection: 'notes', db, schema: noteSchema })

  await NotesModel.insertOne({
    _id: 'n1',
    content: 'Milk',
    owner: { email: 'ana@example.com', name: 'Ana' },
    title: 'Groceries'
  })

  // MongoDB reads { content: 0 } and {} as the whole document, with owner.email.
  const notes = await Promise.all(
    [{ content: 0 }, {}, { _id: 0 }].map((sent) =>
      NotesModel.findOne({ _id: 'n1' }, { projection: notesProjection.parse(sent) })
    )
  )

  expect(notes.map((note) => note?.owner)).toEqual([0, 1, 2].map(() => ({ name: 'Ana' })))
})

test('a path that does not exist does not compile and throws', () => {
  // @ts-expect-error not a path of the document
  expect(() => projection(noteSchema, { titel: true })).toThrow(
    'mz.projection: "titel" is not a path of the document'
  )
})

test('a path and a path inside it throw, which MongoDB rejects in one projection', async () => {
  await expect(
    db.collection('notes').findOne({}, { projection: { 'owner': 1, 'owner.name': 1 } })
  ).rejects.toMatchObject({ code: 31249 })
  expect(() => projection(noteSchema, { 'owner': true, 'owner.name': true })).toThrow(
    'mz.projection: "owner" and "owner.name" overlap, which MongoDB rejects in one projection: declare one of them'
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
