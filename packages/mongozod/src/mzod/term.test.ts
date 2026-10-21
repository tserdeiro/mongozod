import { MongoClient } from 'mongodb'
import { afterAll, beforeAll, beforeEach, expect, expectTypeOf, inject, test } from 'vitest'
import { z } from 'zod'

import { mongozod } from '../mongozod'

import { term } from './term'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-mz-term')

beforeAll(() => client.connect())
afterAll(() => client.close())
beforeEach(() => db.dropDatabase())

const noteSchema = z.object({
  content: z.string(),
  organization: z.string(),
  seo: z.object({ title: z.string() }).optional(),
  tags: z.string().array().default([]),
  title: z.string(),
  views: z.number().default(0)
})

const NotesModel = mongozod({ collection: 'notes', db, schema: noteSchema })

const notesTerm = term(noteSchema, { content: true, tags: true, title: true })

async function titles(text: string | undefined) {
  const notes = await NotesModel.find(notesTerm.parse(text), { sort: { title: 1 } })

  return notes.map((note) => note.title)
}

test('finds each word in one of the paths, as a client types it, without case or accents', async () => {
  await NotesModel.insertMany([
    { content: 'Desayuno de la mañana', organization: 'o', title: 'Café con leche' },
    { content: 'Sin leche', organization: 'o', title: 'Té verde' },
    { content: 'Incluye CAFE', organization: 'o', tags: ['menú'], title: 'Almuerzo' }
  ])

  expect(await titles('cafe')).toEqual(['Almuerzo', 'Café con leche'])
  expect(await titles('CAFÉ')).toEqual(['Almuerzo', 'Café con leche'])
  expect(await titles('desay')).toEqual(['Café con leche'])
  expect(await titles('cafe leche')).toEqual(['Café con leche'])
  expect(await titles('MENU')).toEqual(['Almuerzo'])
  expect(await titles('  ')).toEqual(['Almuerzo', 'Café con leche', 'Té verde'])
  expect(await titles(undefined)).toEqual(['Almuerzo', 'Café con leche', 'Té verde'])
})

test('escapes the text: a client never sends a pattern', async () => {
  await NotesModel.insertMany([
    { content: 'a.b (c+)', organization: 'o', title: 'Symbols [x]' },
    { content: 'abc', organization: 'o', title: 'Plain' }
  ])

  expect(await titles('[x]')).toEqual(['Symbols [x]'])
  expect(await titles('a.b')).toEqual(['Symbols [x]'])
  expect(await titles('(c+)')).toEqual(['Symbols [x]'])
  expect(await titles('.*')).toEqual([])
  expect(notesTerm.parse('ñ,')).toEqual({
    $and: [
      {
        $or: [
          { content: { $options: 'i', $regex: expect.stringMatching(/^\[n[^\],]+\],$/) } },
          { tags: { $options: 'i', $regex: expect.stringMatching(/^\[n[^\],]+\],$/) } },
          { title: { $options: 'i', $regex: expect.stringMatching(/^\[n[^\],]+\],$/) } }
        ]
      }
    ]
  })
})

test('composes with the rest of the filter, and the length is the project decision', async () => {
  const input = z.object({
    term: z.string().max(10).optional().pipe(notesTerm)
  })
  const { term: search } = input.parse({ term: 'cafe' })

  await NotesModel.insertMany([
    { content: '', organization: 'a', title: 'Café' },
    { content: '', organization: 'b', title: 'Café' }
  ])

  expect(await NotesModel.countDocuments({ $and: [search, { organization: 'a' }] })).toBe(1)
  expect(input.parse({})).toEqual({ term: {} })
  expect(input.safeParse({ term: 'a'.repeat(11) }).success).toBe(false)
  expectTypeOf<z.input<typeof input>>().toEqualTypeOf<{ term?: string | undefined }>()
})

test('takes the paths that hold strings, and says why another does not', () => {
  // @ts-expect-error "views" does not hold strings, which a term searches
  term(noteSchema, { views: true })
  expect(() =>
    // @ts-expect-error "titel" is not a path of the document
    term(noteSchema, { titel: true })
  ).toThrow('mz.term: "titel" is not a path of the document')
  expect(() => term(noteSchema, {})).toThrow('mz.term: declare at least one path')
  expect(term(noteSchema, { 'seo.title': true }).parse('a')).toEqual({
    $and: [{ $or: [{ 'seo.title': { $options: 'i', $regex: expect.any(String) } }] }]
  })
})
