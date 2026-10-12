import type { Side } from './filter'
import type * as core from 'zod/v4/core'

import { z } from 'zod'

import { nonEmptyObject } from './internal/non-empty-object'
import { withoutUndefined } from './internal/without-undefined'

type FieldsOf<W> = W extends { _zod: { def: { shape: infer Shape } } }
  ? keyof Shape & string
  : never

/**
 * A `populate` with the declared references, on one side. The client sends `true` or the fields
 * it wants, and the router gets the `projection` of the model's `populate` with those fields.
 */
export type PopulateShape<W, D extends Side> = {
  -readonly [K in keyof W]?: D extends 'input'
    ? true | { [F in FieldsOf<W[K]>]?: 1 | true }
    : { projection: { [F in FieldsOf<W[K]>]?: 1 } }
}

/**
 * The `populate` a client can send: the references it can expand, each with a whitelist of the
 * fields it can see, as a schema such as `organizationSchema.pick({ _id: true, name: true })`.
 * The client sends `true` for the whole whitelist, or a projection with `1` or `true` for some of
 * its fields; anything else fails, so a client never sees more than the whitelist. The router gets
 * the model's `populate`, with a `projection` of those fields. `undefined` keys are dropped. A
 * virtual is declared as a field, with a schema that adds it.
 *
 * @example
 *   populate: mz.populate({
 *     organization: organizationSchema.pick({ _id: true, name: true })
 *   }).optional()
 *
 * @see https://mongozod.dev/docs/api/mzod#mzpopulate
 */
export function populate<const W extends Readonly<Record<string, core.$ZodObject>>>(
  whitelists: W
): z.ZodType<PopulateShape<W, 'output'>, PopulateShape<W, 'input'>>

export function populate(whitelists: Readonly<Record<string, core.$ZodObject>>): z.ZodType {
  return z
    .strictObject(
      Object.fromEntries(
        Object.entries(whitelists).map(([reference, whitelist]) => {
          const fields = Object.keys(whitelist._zod.def.shape)
          const some = nonEmptyObject(
            Object.fromEntries(fields.map((field) => [field, z.literal([1, true])])),
            'takes true, or at least one field'
          ).transform((asked) => ({
            projection: Object.fromEntries(Object.keys(asked).map((field) => [field, 1]))
          }))
          const all = z.literal(true).transform(() => ({
            projection: Object.fromEntries(fields.map((field) => [field, 1]))
          }))

          return [
            reference,
            z.optional(
              z.union([all, some], {
                error: 'takes true, or an object with 1 or true for some of its fields'
              })
            )
          ]
        })
      )
    )
    .overwrite(withoutUndefined)
}
