import type { NotAPath, SchemaAt } from '../schema-at'
import type * as core from 'zod/v4/core'

import { schemaAt } from '../schema-at'

/** A path with an index or a positional operator, which name an element of an array. */
type NamesElement<P extends string> = P extends
  | `${number}`
  | `${number}.${string}`
  | `${string}.${number}`
  | `${string}.${number}.${string}`
  | `$${string}`
  | `${string}.$${string}`
  ? true
  : false

/**
 * Why a path of a builder is not a field outside arrays, or `never` when it is one. A client never
 * names an element: positions and `arrayFilters` stay in the router.
 */
export type OutsideArraysProblem<S, P extends string, B extends string> = string extends P
  ? 'a path must be a literal'
  : NamesElement<P> extends true
    ? `"${P}" names an element of an array: ${B} takes paths outside arrays`
    : [SchemaAt<S, P, 'update'>] extends [never]
      ? [SchemaAt<S, P, 'filter'>] extends [never]
        ? NotAPath<P>
        : `"${P}" goes through an array: ${B} takes paths outside arrays`
      : never

/** A segment that is an index or a positional operator. */
const ELEMENT_SEGMENT = /^(?:\d+|\$.*)$/

/**
 * The schemas of a field outside arrays, the runtime half of `OutsideArraysProblem`. Throws an
 * `Error` that names the builder when the path is not one.
 */
export function schemasOutsideArrays(
  schema: core.$ZodType,
  path: string,
  builder: string
): core.$ZodType[] {
  if (path.split('.').some((segment) => ELEMENT_SEGMENT.test(segment))) {
    throw new Error(
      `${builder}: "${path}" names an element of an array: ${builder} takes paths outside arrays`
    )
  }

  const targets = schemaAt(schema, path, 'update')

  if (targets.length > 0) return targets

  throw new Error(
    schemaAt(schema, path, 'filter').length > 0
      ? `${builder}: "${path}" goes through an array: ${builder} takes paths outside arrays`
      : `${builder}: "${path}" is not a path of the document`
  )
}
