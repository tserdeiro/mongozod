import type * as core from 'zod/v4/core'

import { z } from 'zod'

const OPERATORS_MESSAGE =
  'a value cannot have keys that start with "$", which MongoDB reads as operators'

export const REGEX_MESSAGE =
  'a value cannot be a regular expression, which MongoDB matches as a pattern: declare "$regex"'

/** A regular expression, of JavaScript or of bson, which a filter matches instead of comparing. */
export function isRegExp(value: unknown): boolean {
  return (
    value instanceof RegExp ||
    (typeof value === 'object' &&
      value !== null &&
      '_bsontype' in value &&
      value._bsontype === 'BSONRegExp')
  )
}

/** Whether a value is not an object with a key that starts with `$`. */
function withoutOperators(value: unknown) {
  return (
    typeof value !== 'object' ||
    value === null ||
    !Object.keys(value).some((key) => key.startsWith('$'))
  )
}

/** Why a value is not one a filter compares with, or `undefined` when it is. */
function problem(value: unknown): string | undefined {
  if (isRegExp(value)) return REGEX_MESSAGE

  return withoutOperators(value) ? undefined : OPERATORS_MESSAGE
}

/**
 * The schema of a value a filter compares with: the field's, without an object with a key that
 * starts with `$`. MongoDB reads one as operators in an equality and in `$all`, and rejects it in
 * `$in`, so a field that accepts any object, such as `z.record()` or `z.unknown()`, would let a
 * client send `{ $ne: null }` as a value. No document can store such a key, so it never matches.
 * Nor a regular expression, which MongoDB matches as a pattern where the endpoint declared an
 * equality: JSON never sends one, but a transport such as superjson does, and so does a transform
 * that builds one. The checks run on what the client sends and again on what the schema returns,
 * as a check and not as another pipe, which would hide the issues of the field: a transform, such
 * as one that parses JSON, can turn a string into such an object.
 */
export function filterValue(schema: core.$ZodType) {
  return z
    .unknown()
    .refine((value) => !isRegExp(value), REGEX_MESSAGE)
    .refine(withoutOperators, OPERATORS_MESSAGE)
    .pipe(schema)
    .check((ctx) => {
      const message = problem(ctx.value)

      // It continues, as a refine does: an aborted option makes a union report only `Invalid input`.
      if (message) ctx.issues.push({ code: 'custom', continue: true, input: ctx.value, message })
    })
}
