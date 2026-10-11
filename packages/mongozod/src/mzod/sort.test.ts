import { expect, expectTypeOf, test } from 'vitest'
import { z } from 'zod'

import { sort } from './sort'

const noteSchema = z.object({
  _id: z.uuid(),
  charge: z.object({ feature: z.string() }),
  createdAt: z.date(),
  title: z.string()
})

const notesSort = sort(noteSchema, { 'charge.feature': true, 'createdAt': true, 'title': true })

test('keeps the order of the client, which decides what sorts first', () => {
  expect(Object.keys(notesSort.parse({ title: 1, createdAt: -1 }))).toEqual(['title', 'createdAt'])
  expect(Object.keys(notesSort.parse({ createdAt: -1, title: 1 }))).toEqual(['createdAt', 'title'])
  expect(notesSort.parse({ 'charge.feature': 1, 'title': undefined })).toEqual({
    'charge.feature': 1
  })
})

test('takes the declared paths with 1 or -1, and a default from Zod', () => {
  expect(notesSort.safeParse({ _id: 1 }).success).toBe(false)
  expect(notesSort.safeParse({ title: 'asc' }).success).toBe(false)
  expect(notesSort.safeParse({ title: { $meta: 'textScore' } }).success).toBe(false)
  expect(z.object({ sort: notesSort.default({ createdAt: -1 }) }).parse({})).toEqual({
    sort: { createdAt: -1 }
  })
  expectTypeOf<z.output<typeof notesSort>>().toEqualTypeOf<{
    'charge.feature'?: -1 | 1
    'createdAt'?: -1 | 1
    'title'?: -1 | 1
  }>()
})

test('a path that does not exist does not compile and throws', () => {
  // @ts-expect-error not a path of the document
  expect(() => sort(noteSchema, { titel: true })).toThrow(
    'mz.sort: "titel" is not a path of the document'
  )
})
