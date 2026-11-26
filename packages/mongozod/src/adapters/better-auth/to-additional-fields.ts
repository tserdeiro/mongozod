import type { DBFieldAttribute } from 'better-auth'

import { z } from 'zod'
import * as core from 'zod/v4/core'

import { unwrapSchema } from '../../schema/unwrap-schema'

/** What a field of the mask takes: `true`, or the Better Auth options the schema does not say. */
type FieldConfig = true | { input?: false; returned?: false }

type Base<T> = NonNullable<T>

/** The Better Auth type of a value: the array of the values of an enum, and `json` for the rest. */
type FieldType<T> = [Base<T>] extends [string]
  ? string extends Base<T>
    ? 'string'
    : Base<T>[]
  : [Base<T>] extends [number]
    ? 'number'
    : [Base<T>] extends [boolean]
      ? 'boolean'
      : [Base<T>] extends [Date]
        ? 'date'
        : [Base<T>] extends [string[]]
          ? 'string[]'
          : [Base<T>] extends [number[]]
            ? 'number[]'
            : 'json'

/** The Better Auth field of a schema, whose types Better Auth infers. */
type AdditionalField<S extends core.$ZodType, C> = {
  required: undefined extends core.output<S> ? false : null extends core.output<S> ? false : true
  type: FieldType<core.output<S>>
  validator: { input: S }
} & (undefined extends core.input<S>
  ? undefined extends core.output<S>
    ? unknown
    : { readonly defaultValue: core.output<S> }
  : unknown) &
  (C extends { input: false } ? { input: false } : unknown) &
  (C extends { returned: false } ? { returned: false } : unknown)

type ShapeOf<S> = S extends { _zod: { def: { shape: infer Shape } } } ? Shape : never

/** The mask of a model: some of the fields of its schema, each with `true` or its options. */
type Mask<S> = { [K in keyof ShapeOf<S>]?: FieldConfig }

/** The `additionalFields` of the fields of a mask. */
type AdditionalFields<S, M> = {
  [K in keyof M & keyof ShapeOf<S>]: AdditionalField<ShapeOf<S>[K] & core.$ZodType, M[K]>
}

/** The Better Auth type of a field, under its wrappers. */
function typeOf(field: core.$ZodType): DBFieldAttribute['type'] {
  const inner = unwrapSchema(field)

  if (inner instanceof core.$ZodEnum) {
    return Object.values(inner._zod.def.entries).filter((value) => typeof value === 'string')
  }
  if (inner instanceof core.$ZodString) return 'string'
  if (inner instanceof core.$ZodNumber) return 'number'
  if (inner instanceof core.$ZodBoolean) return 'boolean'
  if (inner instanceof core.$ZodDate) return 'date'
  if (inner instanceof core.$ZodArray) {
    const element = unwrapSchema(inner._zod.def.element)

    if (element instanceof core.$ZodString) return 'string[]'
    if (element instanceof core.$ZodNumber) return 'number[]'
  }

  return 'json'
}

/**
 * The `additionalFields` of Better Auth for some fields of a model, from its schema, so a field
 * Better Auth reads, such as a `role`, is declared once. The mask names each field, as Zod's
 * `.pick()`, with `true` or the options the schema does not say (`input: false`,
 * `returned: false`). Its type comes from the field (a `z.enum` gives its values), as does
 * `required`, a `.default()` as the `defaultValue`, and the schema itself as the validator of the
 * input, so Better Auth checks it with the same rules as the model.
 *
 * The fields of Better Auth and of its plugins stay out of the mask: `additionalFields` replaces
 * them, so an `email` would lose its `unique`, and the `role` of the `admin` plugin its
 * `input: false`, which keeps anyone from signing up as an admin.
 *
 * @example
 *   export const auth = betterAuth({
 *     user: {
 *       additionalFields: toAdditionalFields(UsersModel, {
 *         joinedAt: { input: false },
 *         phone: true,
 *         role: true
 *       })
 *     }
 *   })
 *
 * @see https://mongozod.dev/docs/integrations/better-auth#additional-fields
 */
export function toAdditionalFields<S extends core.$ZodObject, const M extends Mask<S>>(
  model: { readonly schema: S },
  mask: M
): AdditionalFields<S, M>
export function toAdditionalFields(
  model: { readonly schema: core.$ZodType },
  mask: Partial<Record<string, FieldConfig>>
): Record<string, DBFieldAttribute> {
  const { schema } = model

  if (!(schema instanceof core.$ZodObject)) {
    throw new Error('toAdditionalFields takes a model whose schema is a z.object')
  }

  const fields: Record<string, DBFieldAttribute> = {}

  for (const [key, config] of Object.entries(mask)) {
    const field = schema._zod.def.shape[key]

    if (!field) throw new Error(`toAdditionalFields: the schema has no field "${key}"`)

    const empty = z.safeParse(field, undefined)
    const defaulted = empty.success && empty.data !== undefined
    const attribute: DBFieldAttribute = {
      required: !z.safeParse(field, null).success && (!empty.success || defaulted),
      type: typeOf(field),
      validator: { input: field }
    }

    // A getter, so each record gets its own default, as `() => new Date()` gives.
    if (defaulted) {
      Object.defineProperty(attribute, 'defaultValue', {
        enumerable: true,
        get: () => z.parse(field, undefined)
      })
    }

    // Assigned and not spread, which would read the getter once.
    if (config !== true) Object.assign(attribute, config)

    fields[key] = attribute
  }

  return fields
}
