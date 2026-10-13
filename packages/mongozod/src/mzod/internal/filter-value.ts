import type * as core from 'zod/v4/core'

import { z } from 'zod'

const MESSAGE = 'a value cannot have keys that start with "$", which MongoDB reads as operators'

/** Whether a value is not an object with a key that starts with `$`. */
function withoutOperators(value: unknown) {
  return (
    typeof value !== 'object' ||
    value === null ||
    !Object.keys(value).some((key) => key.startsWith('$'))
  )
}

/**
 * The schema of a value a filter compares with: the field's, without an object with a key that
 * starts with `$`. MongoDB reads one as operators in an equality and in `$all`, and rejects it in
 * `$in`, so a field that accepts any object, such as `z.record()` or `z.unknown()`, would let a
 * client send `{ $ne: null }` as a value. No document can store such a key, so it never matches.
 * The check runs on what the client sends and again on what the schema returns, as a check and
 * not as another pipe, which would hide the issues of the field: a transform, such as one that
 * parses JSON, can turn a string into such an object.
 */
export function filterValue(schema: core.$ZodType) {
  return z
    .unknown()
    .refine(withoutOperators, MESSAGE)
    .pipe(schema)
    .check((ctx) => {
      if (!withoutOperators(ctx.value)) {
        // It continues, as a refine does: an aborted option makes a union report only `Invalid input`.
        ctx.issues.push({ code: 'custom', continue: true, input: ctx.value, message: MESSAGE })
      }
    })
}
