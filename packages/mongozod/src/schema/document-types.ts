import * as core from 'zod/v4/core'

import { unwrapSchema } from './unwrap-schema'

/** The keys of every type of document. */
export type FieldsOf<O> = O extends unknown ? keyof O : never

/** The types of document a schema stores: the options of a discriminated union, or the schema. */
export function documentTypes(schema: core.$ZodType): readonly core.$ZodType[] {
  const unwrapped = unwrapSchema(schema)

  return unwrapped instanceof core.$ZodDiscriminatedUnion ? unwrapped._zod.def.options : [schema]
}
