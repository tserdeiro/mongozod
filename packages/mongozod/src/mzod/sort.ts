import type { MaskCheck, SuggestedMask } from './internal/mask-check'
import type * as core from 'zod/v4/core'

import { z } from 'zod'

import { schemaAt } from '../schema/schema-at'

import { withoutUndefined } from './internal/without-undefined'

/**
 * The sort a client can send: MongoDB syntax over the declared paths, with `1` or `-1`. It keeps
 * the order of the keys as the client sends them, which decides what sorts first; `undefined`
 * keys are dropped. It is optional: a client that sends nothing gives `undefined`, the natural
 * order, unless the project gives a default with Zod, such as `.default({ createdAt: -1 })`.
 *
 * @example
 *   sort: mz.sort(noteSchema, { createdAt: true, title: true, updatedAt: true }).default({
 *     createdAt: -1
 *   })
 *
 * @see https://mongozod.dev/docs/api/mzod#mzsort
 */
export function sort<S extends core.$ZodType, const K extends MaskCheck<S, K, 'filter'>>(
  schema: S,
  mask: K & SuggestedMask<S, 'filter'>
): z.ZodOptional<
  z.ZodType<
    Partial<Record<keyof K & string, -1 | 1>>,
    Partial<Record<keyof K & string, -1 | 1 | undefined>>
  >
>

export function sort(schema: core.$ZodType, mask: Readonly<Record<string, true>>): z.ZodType {
  const paths = Object.keys(mask)

  for (const path of paths) {
    if (schemaAt(schema, path, 'filter').length === 0) {
      throw new Error(`mz.sort: "${path}" is not a path of the document`)
    }
  }

  const [first, ...rest] = paths

  if (first === undefined) throw new Error('mz.sort: declare at least one path')

  // A record, and not an object, keeps the order of the client's keys: an object returns its own.
  return z
    .partialRecord(z.enum([first, ...rest]), z.optional(z.literal([1, -1])))
    .overwrite(withoutUndefined)
    .optional()
}
