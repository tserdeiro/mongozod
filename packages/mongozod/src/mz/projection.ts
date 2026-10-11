import type { MaskCheck, SuggestedMask } from './internal/mask-check'
import type * as core from 'zod/v4/core'

import { z } from 'zod'

import { schemaAt } from '../schema/schema-at'

import { withoutUndefined } from './internal/without-undefined'

/**
 * The projection a client can send: MongoDB syntax over the declared paths, with `1` or `true` to
 * include and `0` or `false` to exclude, without mixing both except for `_id`; `undefined` keys
 * are dropped. A virtual is declared as a field, with a schema that adds it, such as
 * `accountSchema.extend({ fullName: z.string() })`.
 *
 * @example
 *   ;```ts
 *   projection: mz.projection(noteSchema, { _id: true, content: true, title: true }).optional()
 *   ```
 */
export function projection<S extends core.$ZodType, const K extends MaskCheck<S, K, 'projection'>>(
  schema: S,
  mask: K & SuggestedMask<S, 'projection'>
): z.ZodType<Partial<Record<keyof K & string, 0 | 1 | boolean>>>

export function projection(schema: core.$ZodType, mask: Readonly<Record<string, true>>): z.ZodType {
  const paths = Object.keys(mask)

  for (const path of paths) {
    if (schemaAt(schema, path, 'projection').length === 0) {
      throw new Error(`mz.projection: "${path}" is not a path of the document`)
    }
  }

  const [first, ...rest] = paths

  if (first === undefined) throw new Error('mz.projection: declare at least one path')

  return z
    .partialRecord(z.enum([first, ...rest]), z.optional(z.union([z.literal([0, 1]), z.boolean()])))
    .overwrite(withoutUndefined)
    .refine(
      (value) =>
        new Set(
          Object.entries(value)
            .filter(([path]) => path !== '_id')
            .map(([, include]) => Boolean(include))
        ).size <= 1,
      {
        message: 'a projection cannot mix inclusion and exclusion, except for _id',
        when: (payload) => payload.issues.length === 0
      }
    )
}
