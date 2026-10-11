import * as core from 'zod/v4/core'

import { unwrapSchema } from './unwrap-schema'

/**
 * The first path of a schema that stores a `z.bigint()`, through objects, arrays, records and
 * unions, or `undefined`. A pipe or a codec stores its output.
 */
export function bigintPath(
  schema: core.$ZodType,
  path = '',
  seen: ReadonlySet<core.$ZodType> = new Set()
): string | undefined {
  const unwrapped = unwrapSchema(schema)

  if (seen.has(unwrapped)) return undefined

  const inner = new Set([...seen, unwrapped])
  const at = (key: string) => (path ? `${path}.${key}` : key)

  if (unwrapped instanceof core.$ZodBigInt) return path
  if (unwrapped instanceof core.$ZodPipe) return bigintPath(unwrapped._zod.def.out, path, inner)
  if (unwrapped instanceof core.$ZodArray)
    return bigintPath(unwrapped._zod.def.element, path, inner)
  if (unwrapped instanceof core.$ZodRecord) {
    return bigintPath(unwrapped._zod.def.valueType, at('*'), inner)
  }

  const children: Array<[core.$ZodType, string]> = []

  if (unwrapped instanceof core.$ZodObject) {
    children.push(
      ...Object.entries(unwrapped._zod.def.shape).map(([key, field]): [core.$ZodType, string] => [
        field,
        at(key)
      ])
    )

    if (unwrapped._zod.def.catchall) children.push([unwrapped._zod.def.catchall, at('*')])
  } else if (unwrapped instanceof core.$ZodUnion || unwrapped instanceof core.$ZodTuple) {
    const options =
      unwrapped instanceof core.$ZodUnion ? unwrapped._zod.def.options : unwrapped._zod.def.items

    children.push(...options.map((option): [core.$ZodType, string] => [option, path]))
  } else if (unwrapped instanceof core.$ZodIntersection) {
    children.push([unwrapped._zod.def.left, path], [unwrapped._zod.def.right, path])
  }

  for (const [child, childPath] of children) {
    const found = bigintPath(child, childPath, inner)

    if (found !== undefined) return found
  }

  return undefined
}
