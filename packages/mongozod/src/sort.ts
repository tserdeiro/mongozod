import type { PathSuggestions } from './path-suggestions'
import type { FieldAt, NotAPath } from './schema-at'

/** The directions of a sort, and `{ $meta: 'textScore' }` to sort by text search relevance. */
export type SortDirection =
  | -1
  | 1
  | 'asc'
  | 'ascending'
  | 'desc'
  | 'descending'
  | { readonly $meta: 'textScore' }

/**
 * Checks a sort key by key: each one must be a path of the document, except one that sorts by text
 * search relevance, whose key is any name, like the field a projection adds with `$meta`.
 */
export type SortCheck<S, Sort> = {
  [K in keyof Sort]: K extends string
    ? Sort[K] extends { $meta: unknown }
      ? { readonly $meta: 'textScore' }
      : string extends K
        ? 'a sort key must be a literal path'
        : [FieldAt<S, K, 'filter'>] extends [never]
          ? NotAPath<K>
          : SortDirection
    : never
}

/** The keys the editor suggests in a sort. The checks come from `SortCheck`. */
export type SuggestedSort<S> = { [K in PathSuggestions<S, 'filter'> | '_id']?: SortDirection }
