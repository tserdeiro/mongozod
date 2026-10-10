import type { Document } from 'mongodb'
import type * as core from 'zod/v4/core'

import { z } from 'zod'

/**
 * Parses a document to write with its schema and drops the keys left `undefined`, which the driver
 * would store as `null`.
 *
 * Parses with Zod Classic's `z.parse`, which also takes Zod Mini schemas, so a failed validation
 * throws a `ZodError`: the `$ZodError` of `zod/v4/core` is not an instance of it.
 */
export function parseDocument(schema: core.$ZodType<Document>, input: unknown): Document {
  return withoutUndefined(z.parse(schema, input))
}

/** Copies a plain object without its `undefined` keys, at every level. */
function withoutUndefined(document: Document): Document {
  return Object.fromEntries(
    Object.entries(document)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, stripValue(value)])
  )
}

/** Goes into arrays and plain objects, and leaves values such as a `Date` or an `ObjectId` alone. */
function stripValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripValue)
  if (isPlainObject(value)) return withoutUndefined(value)

  return value
}

function isPlainObject(value: unknown): value is Document {
  if (typeof value !== 'object' || value === null) return false

  const prototype: unknown = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}
