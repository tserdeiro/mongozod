import * as core from 'zod/v4/core'

import { unwrapSchema } from '../schema/unwrap-schema'

/**
 * Throws an `Error` when a field of the schema has a `.` or starts with `$`, because no path can
 * reach it. The keys of records are checked when a document is written.
 */
export function checkFieldNames(
  schema: core.$ZodType,
  parent = '',
  seen = new Set<core.$ZodType>()
): void {
  const unwrapped = unwrapSchema(schema)

  // A recursive schema leads back to itself through its lazies.
  if (seen.has(unwrapped)) return

  seen.add(unwrapped)

  if (unwrapped instanceof core.$ZodArray) {
    checkFieldNames(unwrapped._zod.def.element, parent, seen)
  } else if (unwrapped instanceof core.$ZodRecord) {
    checkFieldNames(unwrapped._zod.def.valueType, parent, seen)
  } else if (unwrapped instanceof core.$ZodUnion) {
    for (const option of unwrapped._zod.def.options) checkFieldNames(option, parent, seen)
  } else if (unwrapped instanceof core.$ZodObject) {
    const { catchall, shape } = unwrapped._zod.def

    for (const [key, field] of Object.entries(shape)) {
      if (key.includes('.') || key.startsWith('$')) {
        throw new Error(
          `"${key}"${parent && ` in "${parent}"`} is not a valid field name: no path can reach a field with a "." or starting with "$"`
        )
      }

      checkFieldNames(field, parent ? `${parent}.${key}` : key, seen)
    }

    if (catchall) checkFieldNames(catchall, parent, seen)
  }
}
