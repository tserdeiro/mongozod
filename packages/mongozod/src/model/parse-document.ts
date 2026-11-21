import type { Document } from 'mongodb'

import { z } from 'zod'
import * as core from 'zod/v4/core'

import { step } from '../schema/schema-at'
import { holdsLiteral, isLiteral } from '../schema/schema-kinds'
import { unwrapSchema } from '../schema/unwrap-schema'
import { isPlainObject } from '../utils/is-plain-object'
import { setField } from '../utils/set-field'
import { unreachableKey } from '../utils/unreachable-key'

/** The result of parsing a value to write: the value, or every problem it has. */
export type WrittenResult =
  | { data: unknown; success: true }
  | { issues: core.$ZodIssue[]; success: false }

/**
 * Where a value is: `'literal'` inside a field of `mz.literal()`, whose keys are data, or the
 * schemas that describe it, none when no field of `mz.literal()` can be under it.
 */
type Place = 'literal' | core.$ZodType[]

/**
 * Parses a value to write with its schema. Drops the keys left `undefined`, which the driver would
 * store as `null`, and rejects the keys with a `.` or starting with `$`, which no path can reach,
 * except inside a field of `mz.literal()`, or in a value that `literal` says is inside one. The
 * fields of the schema are checked when the model is defined, so these come from records,
 * catchalls and values such as `z.unknown()`.
 *
 * Parses with Zod Classic's `z.safeParseAsync`, which also takes Zod Mini schemas, so that a
 * failure becomes a `ZodError`: the `$ZodError` of `zod/v4/core` is not an instance of it. It is
 * async because a schema can have async refinements, such as one that checks the database, which
 * the sync parse rejects; a write is async anyway.
 */
export async function safeParseWritten(
  schema: core.$ZodType,
  input: unknown,
  literal = false
): Promise<WrittenResult> {
  const result = await z.safeParseAsync(schema, input)

  if (!result.success) return { issues: result.error.issues, success: false }

  const issues: core.$ZodIssue[] = []
  const data = written(
    result.data,
    [],
    issues,
    literal ? 'literal' : holdsLiteral(schema) ? [schema] : []
  )

  if (issues.length > 0) return { issues, success: false }

  return { data, success: true }
}

/** Parses a document to write like `safeParseWritten`, and throws a `ZodError` when it fails. */
export async function parseDocument(
  schema: core.$ZodType<Document>,
  input: unknown
): Promise<Document> {
  const result = await safeParseWritten(schema, input)

  if (!result.success) throw new z.ZodRealError(result.issues)
  if (!isPlainObject(result.data)) {
    throw new z.ZodRealError([
      { code: 'custom', input: result.data, message: 'a document is an object', path: [] }
    ])
  }

  return result.data
}

/** Where the value under a key or an index is, from where its holder is. */
function under(place: Place, key: string): Place {
  if (place === 'literal' || place.length === 0) return place

  const schemas = place.flatMap((schema) => {
    const unwrapped = unwrapSchema(schema)

    // What a pipe stores is its output, such as the schema of a `z.preprocess()`.
    const holder = unwrapped instanceof core.$ZodPipe ? unwrapped._zod.def.out : schema

    // An update names an element by its index only, so a key of an object never enters an array.
    return step(holder, key, 'update').map(([next]) => next)
  })

  return schemas.some(isLiteral) ? 'literal' : schemas
}

/**
 * Copies a value without its `undefined` keys, at every level, and checks the keys it keeps, which
 * are data inside a field of `mz.literal()`.
 */
function written(
  value: unknown,
  path: PropertyKey[],
  issues: core.$ZodIssue[],
  place: Place
): unknown {
  if (place !== 'literal' && place.some(isLiteral)) return written(value, path, issues, 'literal')

  if (Array.isArray(value)) {
    return value.map((element, index) =>
      written(element, [...path, index], issues, under(place, String(index)))
    )
  }

  if (!isPlainObject(value)) return value

  const copy: Document = {}

  for (const [key, field] of Object.entries(value)) {
    if (field === undefined) continue

    const message = place === 'literal' ? undefined : unreachableKey(key)

    if (message) {
      issues.push({
        code: 'custom',
        input: field,
        message: `${message}: mz.literal() stores the keys of a field as data`,
        path: [...path, key]
      })
    }

    setField(copy, key, written(field, [...path, key], issues, under(place, key)))
  }

  return copy
}
