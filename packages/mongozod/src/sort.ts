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

/** Checks a sort key by key: each one must be a path of the document. */
export type SortCheck<S, Sort> = {
  [K in keyof Sort]: K extends string
    ? string extends K
      ? 'a sort key must be a literal path'
      : [FieldAt<S, K, 'filter'>] extends [never]
        ? NotAPath<K>
        : SortDirection
    : never
}

/** A sort on the documents of a schema, with the keys the editor suggests. */
export type ModelSort<S, Sort> = SortCheck<S, Sort> & {
  [K in PathSuggestions<S, 'filter'> | '_id']?: SortDirection
}
