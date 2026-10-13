import type { MaskCheck, SuggestedMask } from './internal/mask-check'
import type * as core from 'zod/v4/core'

import { z } from 'zod'

import { schemaAt } from '../schema/schema-at'

import { withoutUndefined } from './internal/without-undefined'

/**
 * The projection a client can send: MongoDB syntax over the declared paths, with `1` or `true` to
 * include and `0` or `false` to exclude, without mixing both except for `_id`; `undefined` keys are
 * dropped. The mask is the most a client gets: the router always receives an inclusion within it,
 * so an exclusion means the declared paths but those, and `{}` means all of them. MongoDB reads
 * `{ title: 0 }` or `{}` as the whole document, with the fields the mask leaves out. A virtual is
 * declared as a field, with a schema that adds it, such as
 * `accountSchema.extend({ fullName: z.string() })`.
 *
 * @example
 *   projection: mz.projection(noteSchema, { _id: true, content: true, title: true }).prefault({})
 *
 * @see https://mongozod.dev/docs/api/mzod#mzprojection
 */
export function projection<S extends core.$ZodType, const K extends MaskCheck<S, K, 'projection'>>(
  schema: S,
  mask: K & SuggestedMask<S, 'projection'>
): z.ZodType<
  Partial<Record<keyof K & string, 0 | 1>>,
  Partial<Record<keyof K & string, 0 | 1 | boolean>>
>

export function projection(schema: core.$ZodType, mask: Readonly<Record<string, true>>): z.ZodType {
  const paths = Object.keys(mask)

  for (const path of paths) {
    if (schemaAt(schema, path, 'projection').length === 0) {
      throw new Error(`mz.projection: "${path}" is not a path of the document`)
    }

    const parent = paths.find((other) => path.startsWith(`${other}.`))

    // MongoDB rejects both in one projection with a path collision, which an exclusion would send.
    if (parent) {
      throw new Error(
        `mz.projection: "${parent}" and "${path}" overlap, which MongoDB rejects in one projection: declare one of them`
      )
    }
  }

  const [first, ...rest] = paths

  if (first === undefined) throw new Error('mz.projection: declare at least one path')

  const fields = paths.filter((path) => path !== '_id')

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
    .transform((value, context) => {
      const asked = fields.filter((path) => Object.hasOwn(value, path))
      const includes = asked.some((path) => Boolean(value[path]))
      // `{ _id: 1 }` alone is an inclusion of the _id, as in MongoDB.
      const onlyId = asked.length === 0 && Boolean(value._id)
      const included = includes
        ? asked
        : fields.filter((path) => !onlyId && !Object.hasOwn(value, path))
      const withoutId = Object.hasOwn(value, '_id') && !value._id

      if (included.length === 0 && withoutId) {
        context.addIssue({
          code: 'custom',
          input: value,
          message: 'a projection cannot exclude every path the endpoint offers'
        })

        return z.NEVER
      }

      const projected: Record<string, 0 | 1> = Object.fromEntries(included.map((path) => [path, 1]))

      // With no field left, MongoDB still returns the _id, which `{}` would turn into everything.
      if (withoutId) projected._id = 0
      else if (included.length === 0) projected._id = 1

      return projected
    })
}
