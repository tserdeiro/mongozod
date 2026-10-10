import type { PathSuggestions } from '../path-suggestions'
import type { SchemaAt } from '../schema-at'
import type { Side, ValueOf } from './filter'
import type { OutsideArraysProblem } from './outside-arrays'
import type * as core from 'zod/v4/core'

import { z } from 'zod'

import { isOptional } from '../schema-kinds'

import { schemasOutsideArrays } from './outside-arrays'
import { valueSchema } from './value-schema'

type IsRequired<T> =
  undefined extends core.output<T> ? false : null extends core.output<T> ? false : true

type SortKeyCheck<S, K extends string> = [OutsideArraysProblem<S, K, 'mz.cursor'>] extends [never]
  ? IsRequired<SchemaAt<S, K, 'update'>> extends true
    ? -1 | 1
    : `"${K}" can be missing or null: a cursor sorts by required fields`
  : OutsideArraysProblem<S, K, 'mz.cursor'>

/** Checks the sort of `mz.cursor`: each key is a required field outside arrays. */
export type CursorSortCheck<S, O> = {
  [K in keyof O]: K extends string ? SortKeyCheck<S, K> : never
}

type RequiredPath<S> = {
  [P in Exclude<PathSuggestions<S, 'update'>, `$${string}` | `${string}.$${string}`>]: IsRequired<
    SchemaAt<S, P, 'update'>
  > extends true
    ? P
    : never
}[Exclude<PathSuggestions<S, 'update'>, `$${string}` | `${string}.$${string}`>]

/**
 * The paths the editor suggests in the sort of `mz.cursor`, with `_id`, which breaks ties. The
 * types cannot see the order of the keys, so the runtime checks that `_id` is the last one.
 */
export type SuggestedCursorSort<S> = { [K in RequiredPath<S>]?: -1 | 1 } & { _id: -1 | 1 }

/** The values of the sort fields of the last document of a page. */
export type CursorInput<S, O> = {
  [K in keyof O & string]: ValueOf<SchemaAt<S, K, 'update'>, 'input'>
}

type Bound<V, Direction> = Direction extends 1 ? { $gt: V } : { $lt: V }

type Value<S, K extends string, D extends Side> = ValueOf<SchemaAt<S, K, 'update'>, D>

/** The filter of the next page: after the last document, in the order of the sort. */
export interface CursorFilter<S, O> {
  $or?: Array<{
    [K in keyof O & string]?: Value<S, K, 'output'> | Bound<Value<S, K, 'output'>, O[K]>
  }>
}

/**
 * Keyset pagination for infinite scroll. The client sends the sort values of the last document of
 * a page, such as `{ createdAt, _id }`, and the router gets the filter of the next page, which
 * uses the index of the sort; `skip` gets slower as the page grows. Each value is parsed with the
 * schema of its field, so an ISO date becomes a `Date`.
 *
 * The sort has to end with `_id`, which breaks ties, and its fields have to be required: MongoDB
 * sorts a missing or `null` value before any other, so a range on the next page would never reach
 * those documents. The router sorts the same way, and the project decides with Zod what the first
 * page gets, such as `.default({})`.
 *
 * @example
 *   ;```ts
 *   cursor: mz.cursor(brandSchema, { createdAt: -1, _id: -1 }).default({})
 *   ```
 */
export function cursor<S extends core.$ZodType, const O extends CursorSortCheck<S, O>>(
  schema: S,
  sort: O & SuggestedCursorSort<S>
): z.ZodType<CursorFilter<S, O>, CursorInput<S, O>>

export function cursor(schema: core.$ZodType, sort: Readonly<Record<string, number>>): z.ZodType {
  const keys = Object.keys(sort)

  if (keys.at(-1) !== '_id') {
    throw new Error('mz.cursor: the sort ends with _id, which breaks ties')
  }

  const shape: Record<string, core.$ZodType> = {}

  for (const key of keys) {
    if (sort[key] !== 1 && sort[key] !== -1) {
      throw new Error(`mz.cursor: "${key}" sorts with 1 or -1`)
    }

    const targets = schemasOutsideArrays(schema, key, 'mz.cursor')

    if (targets.some((target) => isOptional(target) || z.safeParse(target, null).success)) {
      throw new Error(
        `mz.cursor: "${key}" can be missing or null: a cursor sorts by required fields`
      )
    }

    shape[key] = valueSchema(targets)
  }

  return z.strictObject(shape).transform((last) => ({
    // A document comes after the last one when it ties on the keys before one and passes it there.
    $or: keys.map((key, index) =>
      Object.fromEntries([
        ...keys.slice(0, index).map((previous) => [previous, last[previous]]),
        [key, { [sort[key] === 1 ? '$gt' : '$lt']: last[key] }]
      ])
    )
  }))
}
