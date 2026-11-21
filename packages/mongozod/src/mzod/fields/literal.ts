import { z } from 'zod'
import * as core from 'zod/v4/core'

const DBREF_KEYS = new Set(['$db', '$id', '$ref'])

/**
 * Whether the driver reads an object back as a `DBRef`, as `bson` decides it: its keys that start
 * with `$` are only `$ref`, `$id` and `$db`, with a string `$ref` and an `$id`.
 */
function isDbRefLike(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).filter((key) => key.startsWith('$'))

  return (
    keys.every((key) => DBREF_KEYS.has(key)) &&
    typeof value.$ref === 'string' &&
    value.$id !== undefined &&
    value.$id !== null &&
    (value.$db === undefined || typeof value.$db === 'string')
  )
}

/** The path of the first object of a value that reads back as a `DBRef`, at any level. */
function firstDbRef(value: unknown, path: PropertyKey[]): PropertyKey[] | undefined {
  if (Array.isArray(value)) {
    for (const [index, element] of value.entries()) {
      const found = firstDbRef(element, [...path, index])

      if (found) return found
    }

    return undefined
  }

  if (typeof value !== 'object' || value === null) return undefined

  const prototype: unknown = Object.getPrototypeOf(value)

  if (prototype !== Object.prototype && prototype !== null) return undefined

  const object = Object.fromEntries(Object.entries(value))

  if (isDbRefLike(object)) return path

  for (const [key, field] of Object.entries(object)) {
    const found = firstDbRef(field, [...path, key])

    if (found) return found
  }

  return undefined
}

/**
 * The check of `mz.literal()`: an object that would read back as a `DBRef` is an issue. The model
 * knows a literal field by it, so it is one instance, which the clones of `.optional()` keep.
 */
export const literalKeys = z.check((ctx) => {
  const path = firstDbRef(ctx.value, [])

  if (path) {
    ctx.issues.push({
      code: 'custom',
      input: ctx.value,
      message:
        'an object whose keys that start with "$" are only "$ref", "$id" and "$db" reads back as a DBRef: add another key that starts with "$", or rename them',
      path
    })
  }
})

/**
 * A field whose keys MongoDB doesn't interpret, like `$literal`: a key such as `$state` or `a.b` is
 * stored as data, never read as an operator or a path. It is for values in a format of their own
 * that uses those keys, such as a JSON Schema (`$schema`, `$ref`, `$defs`) or the expressions of a
 * UI spec (`{ $state: '/title' }`). It returns the same schema, with its type, and keeps validating
 * the value with it.
 *
 * Inside the field, a key that starts with `$` or has a `.` is valid, declared or dynamic, in
 * inserts, replacements, `$set`, `$setOnInsert`, and the elements of `$push` and `$addToSet`. No
 * path reaches one: filters, projections, sorts and updates stop at the field or a key above it.
 * An object whose keys that start with `$` are only `$ref`, `$id` and `$db` fails, because the
 * driver reads it back as a `DBRef`. `mz.filter` and `mz.update` still reject these keys in what a
 * client sends.
 *
 * A value read from the field is data: compare it with `$eq` in a filter, and wrap it with
 * `$literal` in a pipeline, which would read its keys as operators.
 *
 * @example
 *   import * as mz from 'mongozod/mzod'
 *
 *   const toolSchema = z.object({ name: z.string(), inputSchema: mz.literal(z.json()) })
 *
 * @see https://mongozod.dev/docs/api/mzod#mzliteral
 */
export function literal<T extends core.$ZodType>(schema: T): T {
  return core.clone(schema, {
    ...schema._zod.def,
    checks: [...(schema._zod.def.checks ?? []), literalKeys]
  })
}
