import * as core from 'zod/v4/core'

import { unwrapSchema } from './unwrap-schema'

/**
 * The first path of a schema that stores a value of a kind, such as a `z.bigint()`, through
 * objects, arrays, records and unions, or `undefined`. A pipe or a codec stores its output.
 */
export function findPath(
  schema: core.$ZodType,
  matches: (schema: core.$ZodType) => boolean,
  path = '',
  seen: ReadonlySet<core.$ZodType> = new Set()
): string | undefined {
  const unwrapped = unwrapSchema(schema)

  if (seen.has(unwrapped)) return undefined

  const inner = new Set([...seen, unwrapped])
  const at = (key: string) => (path ? `${path}.${key}` : key)

  if (matches(unwrapped)) return path
  if (unwrapped instanceof core.$ZodPipe) {
    return findPath(unwrapped._zod.def.out, matches, path, inner)
  }
  if (unwrapped instanceof core.$ZodArray) {
    return findPath(unwrapped._zod.def.element, matches, path, inner)
  }
  if (unwrapped instanceof core.$ZodRecord) {
    return findPath(unwrapped._zod.def.valueType, matches, at('*'), inner)
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
    const found = findPath(child, matches, childPath, inner)

    if (found !== undefined) return found
  }

  return undefined
}
