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
  expect(JSON.stringify(notesSort.parse({ title: 1, createdAt: -1 }))).toBe(
    '{"title":1,"createdAt":-1}'
  )
  expect(JSON.stringify(notesSort.parse({ createdAt: -1, title: 1 }))).toBe(
    '{"createdAt":-1,"title":1}'
  )
  expect(notesSort.parse({ 'charge.feature': 1, 'title': undefined })).toEqual({
    'charge.feature': 1
  })
})

test('takes the declared paths with 1 or -1, nothing, or a default from Zod', () => {
  expect(notesSort.safeParse({ _id: 1 }).success).toBe(false)
  expect(notesSort.safeParse({ title: 'asc' }).success).toBe(false)
  expect(notesSort.safeParse({ title: { $meta: 'textScore' } }).success).toBe(false)
  // Nothing is the natural order, unless the project gives a default.
  expect(z.object({ sort: notesSort }).parse({})).toEqual({})
  const listSort = notesSort.default({ createdAt: -1 })

  expect(z.object({ sort: listSort }).parse({})).toEqual({ sort: { createdAt: -1 } })
  expectTypeOf<z.output<typeof listSort>>().toEqualTypeOf<{
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

test('types what a client sends, so it knows the paths and the directions a list takes', () => {
  expectTypeOf<z.input<typeof notesSort>>().toEqualTypeOf<
    | {
        'charge.feature'?: -1 | 1 | undefined
        'createdAt'?: -1 | 1 | undefined
        'title'?: -1 | 1 | undefined
      }
    | undefined
  >()

  const sent = { createdAt: -1 } as const

  expect(notesSort.parse(sent)).toEqual(sent)
  // @ts-expect-error a client sorts by the declared paths only
  expectTypeOf({ titel: 1 }).toMatchTypeOf<z.input<typeof notesSort>>()
})
