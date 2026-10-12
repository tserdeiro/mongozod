import { z } from 'zod'
import * as core from 'zod/v4/core'

import { unwrapSchema } from './unwrap-schema'

/**
 * The schema of a field under its wrappers, without its checks, such as its refinements: the
 * schema of a value that changes the field, like the amount `$inc` adds to a decimal, which the
 * checks of the field's value do not apply to. In a union, that of each option that can hold a
 * value: `null` changes nothing.
 */
export function withoutChecks(schema: core.$ZodType): core.$ZodType {
  const unwrapped = unwrapSchema(schema)

  if (unwrapped instanceof core.$ZodUnion) {
    return z.union(
      unwrapped._zod.def.options
        .filter((option) => !(unwrapSchema(option) instanceof core.$ZodNull))
        .map(withoutChecks)
    )
  }

  return core.clone(unwrapped, { ...unwrapped._zod.def, checks: [] })
}
