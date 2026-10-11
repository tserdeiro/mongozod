import type { Document } from 'mongodb'
import type * as core from 'zod/v4/core'

import { z } from 'zod'

import { isPlainObject } from '../utils/is-plain-object'

/** The result of parsing a value to write: the value, or every problem it has. */
export type WrittenResult =
  | { data: unknown; success: true }
  | { issues: core.$ZodIssue[]; success: false }

/**
 * Parses a value to write with its schema. Drops the keys left `undefined`, which the driver would
 * store as `null`, and rejects the keys with a `.` or starting with `$`, which no path can reach.
 * The fields of the schema are checked when the model is defined, so these come from records,
 * catchalls and values such as `z.unknown()`.
 *
 * Parses with Zod Classic's `z.safeParseAsync`, which also takes Zod Mini schemas, so that a
 * failure becomes a `ZodError`: the `$ZodError` of `zod/v4/core` is not an instance of it. It is
 * async because a schema can have async refinements, such as one that checks the database, which
 * the sync parse rejects; a write is async anyway.
 */
export async function safeParseWritten(
  schema: core.$ZodType,
  input: unknown
): Promise<WrittenResult> {
  const result = await z.safeParseAsync(schema, input)

  if (!result.success) return { issues: result.error.issues, success: false }

  const issues: core.$ZodIssue[] = []
  const data = written(result.data, [], issues)

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

/** Copies a value without its `undefined` keys, at every level, and checks the keys it keeps. */
function written(value: unknown, path: PropertyKey[], issues: core.$ZodIssue[]): unknown {
  if (Array.isArray(value)) {
    return value.map((element, index) => written(element, [...path, index], issues))
  }

  if (!isPlainObject(value)) return value

  const copy: Document = {}

  for (const [key, field] of Object.entries(value)) {
    if (field === undefined) continue

    if (key.includes('.') || key.startsWith('$')) {
      issues.push({
        code: 'custom',
        input: field,
        message: `"${key}" cannot be a key: no path reaches a key with a "." or starting with "$"`,
        path: [...path, key]
      })
    }

    copy[key] = written(field, [...path, key], issues)
  }

  return copy
}
