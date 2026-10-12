import type { FieldAt, NotAPath } from '../schema/schema-at'
import type { FilterCheck, SuggestedFilter } from '../types/filter'
import type { PathSuggestions } from '../types/path-suggestions'
import type { IndexDescription, IndexDirection } from 'mongodb'
import type * as core from 'zod/v4/core'

import { schemaAt } from '../schema/schema-at'

/**
 * An index key: a path of the document, through arrays like a filter, or a wildcard (`$**` or
 * `path.$**`).
 */
type IndexKeyCheck<S, K> = {
  [P in keyof K]: P extends '$**'
    ? IndexDirection
    : P extends `${infer Base}.$**`
      ? [FieldAt<S, Base, 'filter'>] extends [never]
        ? NotAPath<Base>
        : IndexDirection
      : P extends string
        ? [FieldAt<S, P, 'filter'>] extends [never]
          ? NotAPath<P>
          : IndexDirection
        : never
}

/** The `weights` of a text index: each key is a path of the document, or `$**`. */
type WeightsCheck<S, W> = {
  [P in keyof W]: P extends '$**'
    ? number
    : P extends string
      ? [FieldAt<S, P, 'filter'>] extends [never]
        ? NotAPath<P>
        : number
      : never
}

/**
 * When the key is empty, a property named after the problem, which the key lacks, so that the error
 * shows it: a check in a generic's constraint cannot be conditional on it.
 */
type NotEmpty<K> = [keyof K] extends [never]
  ? { 'an index takes at least one key': never }
  : unknown

/** The keys the editor suggests in an index. The checks come from `IndexKeyCheck`. */
type SuggestedIndexKey<S> = {
  [P in PathSuggestions<S, 'filter'> | '_id' | '$**']?: IndexDirection
}

/** The options of an index: the driver's `IndexDescription`, but its key. */
type IndexOptions = Omit<IndexDescription, 'key'>

/**
 * Declares an index, like the driver's `createIndex(key, options)` and Mongoose's
 * `schema.index(fields, options)`: each key is a path of the document, and
 * `partialFilterExpression` is checked like a filter. Returns the driver's `IndexDescription`.
 */
export type IndexFunction<S> = <
  const K extends IndexKeyCheck<S, K>,
  const F extends FilterCheck<S, F>,
  const W extends WeightsCheck<S, W>
>(
  key: K & SuggestedIndexKey<S> & NotEmpty<K>,
  options?: Omit<IndexOptions, 'partialFilterExpression' | 'weights'> & {
    partialFilterExpression?: F & SuggestedFilter<S>
    weights?: W & { [P in PathSuggestions<S, 'filter'> | '$**']?: number }
  }
) => IndexDescription

/**
 * The indexes of a model, from its `indexes` callback. Throws an `Error` when an index has no key,
 * or when a key or a key of its `weights` is not a path of the document.
 */
export function indexesOf(
  schema: core.$ZodType,
  indexes?: (
    index: (key: Record<string, IndexDirection>, options?: IndexOptions) => IndexDescription
  ) => readonly IndexDescription[]
): IndexDescription[] {
  const declared = indexes?.((key, options) => ({ ...options, key })) ?? []

  for (const { key, weights } of declared) {
    const paths = [...(key instanceof Map ? key.keys() : Object.keys(key))]

    if (paths.length === 0) throw new Error('an index takes at least one key')

    for (const path of [...paths, ...Object.keys(weights ?? {})]) {
      // A wildcard indexes every field, or every field under a path.
      const field = path.replace(/(^|\.)\$\*\*$/, '')

      if (field && field !== '_id' && schemaAt(schema, field, 'filter').length === 0) {
        throw new Error(`index key "${path}" is not a path of the document`)
      }
    }
  }

  return [...declared]
}
