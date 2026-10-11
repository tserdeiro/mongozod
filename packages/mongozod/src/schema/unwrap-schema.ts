import type { Def, Wrapper } from './schema-at'

import * as core from 'zod/v4/core'

/**
 * The schema under its wrappers and lazies, option by option: the types
 * of `unwrapSchema`.
 */
export type Unwrap<S> = S extends unknown
  ? Def<S> extends infer X
    ? X extends { innerType: infer I; type: Wrapper }
      ? Unwrap<I>
      : X extends { getter: () => infer L; type: 'lazy' }
        ? Unwrap<L>
        : S
    : never
  : never

/** The schema under its wrappers (`optional`, `nullable`, `default`…) and lazies. */
export function unwrapSchema(schema: core.$ZodType): core.$ZodType {
  if (
    schema instanceof core.$ZodCatch ||
    schema instanceof core.$ZodDefault ||
    schema instanceof core.$ZodNonOptional ||
    schema instanceof core.$ZodNullable ||
    schema instanceof core.$ZodOptional ||
    schema instanceof core.$ZodPrefault ||
    schema instanceof core.$ZodReadonly
  ) {
    return unwrapSchema(schema._zod.def.innerType)
  }

  // `innerType` keeps the schema the getter returns: each call to the getter of `z.json()` builds
  // a new one, so a walk that calls it never sees the same schema twice.
  if (schema instanceof core.$ZodLazy) return unwrapSchema(schema._zod.innerType)

  return schema
}
