import type { AfterFilter, AfterInput, AfterSortCheck, SuggestedAfterSort } from './after'
import type { FilterFieldsCheck, FilterSchema, SuggestedFilterFields } from './filter'
import type { MaskCheck, SuggestedMask } from './internal/mask-check'
import type { SuggestedTermMask, TermFilter, TermMaskCheck } from './term'
import type { SuggestedUpdateFields, UpdateFieldsCheck, UpdateShape } from './update'
import type { z } from 'zod'
import type * as core from 'zod/v4/core'

import { after } from './after'
import { filter } from './filter'
import { projection } from './projection'
import { sort } from './sort'
import { term } from './term'
import { update } from './update'

/**
 * The builders of `mongozod/mzod` that take a document's schema, bound to one: each takes what it
 * takes after the schema, with the same checks, suggestions and result.
 *
 * @see https://mongozod.dev/docs/api/mzod#mzfrom
 */
export interface SchemaBuilders<S extends core.$ZodType> {
  /** `mz.after(schema, sort)`. */
  after<const O extends AfterSortCheck<S, O>>(
    sort: O & SuggestedAfterSort<S>
  ): z.ZodDefault<z.ZodType<AfterFilter<S, O>, AfterInput<S, O>>>

  /** `mz.filter(schema, fields)`. */
  filter<const F extends FilterFieldsCheck<S, F>>(
    fields: F & SuggestedFilterFields<S, F>
  ): FilterSchema<S, F>

  /** `mz.projection(schema, mask)`. */
  projection<const K extends MaskCheck<S, K, 'projection'>>(
    mask: K & SuggestedMask<S, 'projection'>
  ): z.ZodPrefault<
    z.ZodType<
      Partial<Record<keyof K & string, 0 | 1>>,
      Partial<Record<keyof K & string, 0 | 1 | boolean>>
    >
  >

  /** `mz.sort(schema, mask)`. */
  sort<const K extends MaskCheck<S, K, 'filter'>>(
    mask: K & SuggestedMask<S, 'filter'>
  ): z.ZodOptional<
    z.ZodType<
      Partial<Record<keyof K & string, -1 | 1>>,
      Partial<Record<keyof K & string, -1 | 1 | undefined>>
    >
  >

  /** `mz.term(schema, mask)`. */
  term<const K extends TermMaskCheck<S, K>>(
    mask: K & SuggestedTermMask<S>
  ): z.ZodPrefault<z.ZodType<TermFilter<keyof K & string>, string>>

  /** `mz.update(schema, operators)`. */
  update<const U extends UpdateFieldsCheck<S, U>>(
    operators: U & SuggestedUpdateFields<S, U>
  ): z.ZodType<UpdateShape<S, U, 'output'>, UpdateShape<S, U, 'input'>>
}

/**
 * The builders of endpoint inputs bound to a document's schema, so that the inputs of a module
 * name it once: `mz.from(noteSchema).filter({ … })` is `mz.filter(noteSchema, { … })`. It loads
 * every builder that takes a schema, so a client bundle that uses it keeps all six; the loose
 * builders keep only the ones a file imports.
 *
 * @example
 *   const notes = mz.from(noteSchema)
 *
 *   export const listNotesSchema = z.object({
 *     filter: notes.filter({ status: ['$eq'], tags: ['$in'] }).default({}),
 *     term: z
 *       .string()
 *       .max(100)
 *       .optional()
 *       .pipe(notes.term({ title: true, content: true })),
 *     options: z
 *       .object({ sort: notes.sort({ createdAt: true }).default({ createdAt: -1 }) })
 *       .prefault({})
 *   })
 *
 * @see https://mongozod.dev/docs/api/mzod#mzfrom
 */
export function from<S extends core.$ZodType>(schema: S): SchemaBuilders<S>

export function from(
  schema: core.$ZodType
): Record<keyof SchemaBuilders<core.$ZodType>, (declaration: never) => z.ZodType> {
  return {
    after: (sortBy: never) => after(schema, sortBy),
    filter: (fields: never) => filter(schema, fields),
    projection: (mask: never) => projection(schema, mask),
    sort: (mask: never) => sort(schema, mask),
    term: (mask: never) => term(schema, mask),
    update: (operators: never) => update(schema, operators)
  }
}
