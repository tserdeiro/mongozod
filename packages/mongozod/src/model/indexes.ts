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
  const F extends FilterCheck<S, F>
>(
  key: K & SuggestedIndexKey<S>,
  options?: Omit<IndexOptions, 'partialFilterExpression'> & {
    partialFilterExpression?: F & SuggestedFilter<S>
  }
) => IndexDescription

/**
 * The indexes of a model, from its `indexes` callback. Throws an `Error` when a key is not a path
 * of the document.
 */
export function indexesOf(
  schema: core.$ZodType,
  indexes?: (
    index: (key: Record<string, IndexDirection>, options?: IndexOptions) => IndexDescription
  ) => readonly IndexDescription[]
): IndexDescription[] {
  const declared = indexes?.((key, options) => ({ ...options, key })) ?? []

  for (const { key } of declared) {
    for (const path of key instanceof Map ? key.keys() : Object.keys(key)) {
      // A wildcard indexes every field, or every field under a path.
      const field = path.replace(/(^|\.)\$\*\*$/, '')

      if (field && field !== '_id' && schemaAt(schema, field, 'filter').length === 0) {
        throw new Error(`index key "${path}" is not a path of the document`)
      }
    }
  }

  return [...declared]
}
