import type * as core from 'zod/v4/core'

import { z } from 'zod'

import { withoutUndefined } from './without-undefined'

/**
 * A strict object of optional keys that needs at least one of them, without counting `undefined`
 * ones. The message only shows when its keys are valid, so it does not repeat another problem.
 */
export function nonEmptyObject(shape: Record<string, core.$ZodType>, message: string) {
  return z
    .strictObject(
      Object.fromEntries(Object.entries(shape).map(([key, schema]) => [key, z.optional(schema)]))
    )
    .overwrite(withoutUndefined)
    .refine((value) => Object.keys(value).length > 0, {
      message,
      when: (payload) => payload.issues.length === 0
    })
}
