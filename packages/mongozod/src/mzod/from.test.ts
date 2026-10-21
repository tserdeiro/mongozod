import { expect, expectTypeOf, test } from 'vitest'
import { z } from 'zod'

import { after } from './after'
import { filter } from './filter'
import { from } from './from'
import { projection } from './projection'
import { sort } from './sort'
import { term } from './term'
import { update } from './update'

const noteSchema = z.object({
  _id: z.string(),
  content: z.string(),
  createdAt: z.date(),
  tags: z.string().array().default([]),
  title: z.string(),
  views: z.number().int().default(0)
})

const notes = from(noteSchema)

test('each builder takes what it takes after the schema, and gives the same schema', () => {
  const bound = {
    after: notes.after({ createdAt: -1, _id: -1 }),
    filter: notes.filter({ _id: [], tags: ['$in'] }),
    projection: notes.projection({ content: true, title: true }),
    sort: notes.sort({ createdAt: true, title: true }),
    term: notes.term({ content: true, title: true }),
    update: notes.update({ $inc: ['views'], $set: ['title'] })
  }
  const loose = {
    after: after(noteSchema, { createdAt: -1, _id: -1 }),
    filter: filter(noteSchema, { _id: [], tags: ['$in'] }),
    projection: projection(noteSchema, { content: true, title: true }),
    sort: sort(noteSchema, { createdAt: true, title: true }),
    term: term(noteSchema, { content: true, title: true }),
    update: update(noteSchema, { $inc: ['views'], $set: ['title'] })
  }

  expectTypeOf(bound).toEqualTypeOf(loose)
  expect(bound.filter.parse({ _id: 'a', tags: { $in: ['x'] } })).toEqual(
    loose.filter.parse({ _id: 'a', tags: { $in: ['x'] } })
  )
  expect(bound.sort.parse({ title: 1 })).toEqual({ title: 1 })
  expect(bound.projection.parse(undefined)).toEqual({ content: 1, title: 1 })
  expect(bound.term.parse('cafe')).toEqual(loose.term.parse('cafe'))
  expect(bound.update.parse({ $inc: { views: 1 } })).toEqual({ $inc: { views: 1 } })
  expect(bound.after.parse({ createdAt: new Date(0), _id: 'a' })).toEqual(
    loose.after.parse({ createdAt: new Date(0), _id: 'a' })
  )
})

test('checks the declarations against the bound schema', () => {
  // @ts-expect-error "titel" is not a path of the document
  expect(() => notes.sort({ titel: true })).toThrow(
    'mz.sort: "titel" is not a path of the document'
  )
  // @ts-expect-error "views" does not hold strings, which a term searches
  notes.term({ views: true })
  // @ts-expect-error "title" is not a number
  expect(() => notes.update({ $inc: ['title'] })).toThrow('"title" is not a number')
})
