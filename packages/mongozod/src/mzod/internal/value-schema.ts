import { z } from 'zod'
import * as core from 'zod/v4/core'

function withoutDefault(schema: core.$ZodType): core.$ZodType {
  if (
    schema instanceof core.$ZodDefault ||
    schema instanceof core.$ZodOptional ||
    schema instanceof core.$ZodPrefault
  ) {
    return withoutDefault(schema._zod.def.innerType)
  }

  return schema
}

/**
 * The schema of a value the client sends for a path: the field's, or a union of them through a
 * union, without the wrappers that make it optional or fill a default. An input never gets a
 * default the client did not send, such as a fresh `_id` in a filter.
 */
export function valueSchema(schemas: readonly core.$ZodType[]): core.$ZodType {
  const [first, ...rest] = schemas.map(withoutDefault)

  if (!first) throw new Error('valueSchema needs a schema')

  return rest.length === 0 ? first : z.union([first, ...rest])
}
