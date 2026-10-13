import type * as core from 'zod/v4/core'

import { z } from 'zod'

/**
 * The schema of a value a filter compares with: the field's, without an object with a key that
 * starts with `$`. MongoDB reads one as operators in an equality and in `$all`, and rejects it in
 * `$in`, so a field that accepts any object, such as `z.record()` or `z.unknown()`, would let a
 * client send `{ $ne: null }` as a value. No document can store such a key, so it never matches.
 */
export function filterValue(schema: core.$ZodType) {
  return z
    .unknown()
    .refine(
      (value) =>
        typeof value !== 'object' ||
        value === null ||
        !Object.keys(value).some((key) => key.startsWith('$')),
      'a value cannot have keys that start with "$", which MongoDB reads as operators'
    )
    .pipe(schema)
}
