import type { FieldAt, NotAPath } from '../schema/schema-at'
import type { PathSuggestions } from './path-suggestions'
import type { SortDirection as DriverSortDirection } from 'mongodb'

/** `{ $meta: 'textScore' }`, which sorts by text search relevance. */
interface TextScore {
  readonly $meta: 'textScore'
}

/** The driver's directions of a sort, with its `$meta` narrowed to `textScore`. */
export type SortDirection = Exclude<DriverSortDirection, { readonly $meta: string }> | TextScore

/**
 * Checks a sort key by key: each one must be a path of the document, except one that sorts by text
 * search relevance, whose key is any name, like the field a projection adds with `$meta`.
 */
export type SortCheck<S, Sort> = {
  [K in keyof Sort]: K extends string
    ? Sort[K] extends { $meta: unknown }
      ? TextScore
      : string extends K
        ? 'a sort key must be a literal path'
        : [FieldAt<S, K, 'filter'>] extends [never]
          ? NotAPath<K>
          : SortDirection
    : never
}

/** The keys the editor suggests in a sort. The checks come from `SortCheck`. */
export type SuggestedSort<S> = { [K in PathSuggestions<S, 'filter'> | '_id']?: SortDirection }
