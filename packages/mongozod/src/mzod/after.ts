import type { SchemaAt } from '../schema/schema-at'
import type { PathSuggestions } from '../types/path-suggestions'
import type { Side, ValueOf } from './filter'
import type { OutsideArraysProblem } from './internal/outside-arrays'

import { z } from 'zod'
import * as core from 'zod/v4/core'

import { isOptional, variants } from '../schema/schema-kinds'

import { schemasOutsideArrays } from './internal/outside-arrays'
import { valueSchema } from './internal/value-schema'

type IsRequired<T> =
  undefined extends core.output<T> ? false : null extends core.output<T> ? false : true

/** Whether a field can store an array, which MongoDB sorts by one of its elements. */
type HoldsArray<T> = [Extract<core.output<T>, ReadonlyArray<unknown>>] extends [never]
  ? false
  : true

type SortKeyCheck<S, K extends string> = [OutsideArraysProblem<S, K, 'mz.after'>] extends [never]
  ? HoldsArray<SchemaAt<S, K, 'update'>> extends true
    ? `"${K}" is an array: mz.after sorts by fields of one value`
    : IsRequired<SchemaAt<S, K, 'update'>> extends true
      ? -1 | 1
      : `"${K}" can be missing or null: mz.after sorts by required fields`
  : OutsideArraysProblem<S, K, 'mz.after'>

/** Checks the sort of `mz.after`: each key is a required field of one value, outside arrays. */
export type AfterSortCheck<S, O> = {
  [K in keyof O]: K extends string ? SortKeyCheck<S, K> : never
}

type RequiredPath<S> = {
  [P in Exclude<PathSuggestions<S, 'update'>, `$${string}` | `${string}.$${string}`>]: IsRequired<
    SchemaAt<S, P, 'update'>
  > extends true
    ? HoldsArray<SchemaAt<S, P, 'update'>> extends true
      ? never
      : P
    : never
}[Exclude<PathSuggestions<S, 'update'>, `$${string}` | `${string}.$${string}`>]

/**
 * The paths the editor suggests in the sort of `mz.after`, with `_id`, which breaks ties. The
 * types cannot see the order of the keys, so the runtime checks that `_id` is the last one.
 */
export type SuggestedAfterSort<S> = { [K in RequiredPath<S>]?: -1 | 1 } & { _id: -1 | 1 }

/** The values of the sort fields of the last document of a page. */
export type AfterInput<S, O> = {
  [K in keyof O & string]: ValueOf<SchemaAt<S, K, 'update'>, 'input'>
}

type Bound<V, Direction> = Direction extends 1 ? { $gt: V } : { $lt: V }

type Value<S, K extends string, D extends Side> = ValueOf<SchemaAt<S, K, 'update'>, D>

/** The filter of the next page: after the last document, in the order of the sort. */
export interface AfterFilter<S, O> {
  $or?: Array<{
    [K in keyof O & string]?: Value<S, K, 'output'> | Bound<Value<S, K, 'output'>, O[K]>
  }>
}

/**
 * The page after a document, for infinite scroll or a "next" button: the range queries of the
 * MongoDB manual, named after the `searchAfter` of Atlas Search. The client sends the sort values
 * of the last document of a page, such as `{ createdAt, _id }`, and the router gets the filter of
 * the next page, which uses the index of the sort; `skip`, for numbered pages, gets slower as the
 * offset grows. Each value is parsed with the schema of its field, so an ISO date becomes a
 * `Date`.
 *
 * The sort has to end with `_id`, which breaks ties, and its fields have to be required: MongoDB
 * sorts a missing or `null` value before any other, so a range on the next page would never reach
 * those documents. An array does not fit either: MongoDB sorts it by one of its elements, and a
 * range matches it when any element passes. The router sorts the same way, and the project decides
 * with Zod what the first page gets, such as `.default({})`.
 *
 * @example
 *   after: mz.after(brandSchema, { createdAt: -1, _id: -1 }).default({})
 */
export function after<S extends core.$ZodType, const O extends AfterSortCheck<S, O>>(
  schema: S,
  sort: O & SuggestedAfterSort<S>
): z.ZodType<AfterFilter<S, O>, AfterInput<S, O>>

export function after(schema: core.$ZodType, sort: Readonly<Record<string, number>>): z.ZodType {
  const keys = Object.keys(sort)

  if (keys.at(-1) !== '_id') {
    throw new Error('mz.after: the sort ends with _id, which breaks ties')
  }

  const shape: Record<string, core.$ZodType> = {}

  for (const key of keys) {
    if (sort[key] !== 1 && sort[key] !== -1) {
      throw new Error(`mz.after: "${key}" sorts with 1 or -1`)
    }

    const targets = schemasOutsideArrays(schema, key, 'mz.after')
    const holdsArray = targets.some((target) =>
      variants(target).some(
        (variant) => variant instanceof core.$ZodArray || variant instanceof core.$ZodTuple
      )
    )

    if (holdsArray) {
      throw new Error(`mz.after: "${key}" is an array: mz.after sorts by fields of one value`)
    }

    if (targets.some((target) => isOptional(target) || z.safeParse(target, null).success)) {
      throw new Error(
        `mz.after: "${key}" can be missing or null: mz.after sorts by required fields`
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
