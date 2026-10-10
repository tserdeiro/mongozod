import * as core from 'zod/v4/core'

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

  if (schema instanceof core.$ZodLazy) return unwrapSchema(schema._zod.def.getter())

  return schema
}
