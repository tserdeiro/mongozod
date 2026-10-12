import type * as core from 'zod/v4/core'

import { z } from 'zod'

import { valueKey } from '../../utils/value-key'

/**
 * The check of a set: a repeated value is an issue at its index. The model knows a set by it, so
 * it is one instance, which the clones of `.min()` or `.optional()` keep.
 */
export const uniqueValues = z.check<unknown[]>((ctx) => {
  const seen = new Set<string>()

  for (const [index, value] of ctx.value.entries()) {
    const key = valueKey(value)

    if (seen.has(key)) {
      ctx.issues.push({
        code: 'custom',
        input: value,
        message: 'is repeated: a set keeps each value once',
        path: [index]
      })
    }

    seen.add(key)
  }
})

/** What tells the types that an array is a set. */
export interface SetMarker {
  readonly '~set': true
}

const marker: SetMarker = { '~set': true }

/**
 * A set field, the array of `$addToSet`: it keeps each value once. It is an array, the type reads
 * return, unlike the `Set` of `z.set()`. A repeated value fails, with MongoDB's equality: numbers
 * by their value, BSON values such as an `ObjectId` by theirs, and objects by their fields in any
 * order, as the `uniqueItems` of the `$jsonSchema` of `sync()`, which it sets. The model's updates
 * add to it only with `$addToSet`: `$push`, or writing an element by its index or a positional
 * operator, does not compile and throws a `ZodError`.
 *
 * @example
 *   import * as mz from 'mongozod/mzod'
 *
 *   const postSchema = z.object({ tags: mz.set(z.string()).default([]) })
 *
 * @see https://mongozod.dev/docs/api/mzod#mzset
 */
export function set<T extends core.SomeType>(item: T): z.ZodArray<T> & SetMarker {
  return Object.assign(z.array(item).check(uniqueValues), marker)
}
