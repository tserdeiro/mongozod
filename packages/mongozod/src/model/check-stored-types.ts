import * as core from 'zod/v4/core'

import { findPath } from '../schema/find-path'

/**
 * Throws an `Error` when the schema stores a `z.set()` or a `z.map()`: the driver writes a `Set` as
 * an empty object and a `Map` as an object, so neither comes back from a read.
 */
export function checkStoredTypes(schema: core.$ZodType): void {
  const set = findPath(schema, (field) => field instanceof core.$ZodSet)

  if (set !== undefined) {
    throw new Error(
      `"${set}" is a z.set(), which the driver stores as an empty object: use mz.set() for an array without repeats`
    )
  }

  const map = findPath(schema, (field) => field instanceof core.$ZodMap)

  if (map !== undefined) {
    throw new Error(
      `"${map}" is a z.map(), which the driver stores as an object and reads as one: use z.record()`
    )
  }
}
