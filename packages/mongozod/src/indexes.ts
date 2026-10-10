import type { FilterCheck } from './filter'
import type { FieldAt, NotAPath } from './schema-at'
import type { IndexDescription, IndexDirection } from 'mongodb'

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

type IndexCheck<S, X> = X extends { key: infer K }
  ? Omit<IndexDescription, 'key' | 'partialFilterExpression'> & {
      key: IndexKeyCheck<S, K>
      partialFilterExpression?: X extends { partialFilterExpression: infer F }
        ? FilterCheck<S, F>
        : never
    }
  : 'an index has a key'

/**
 * Checks the `indexes` of a model, the driver's `IndexDescription`s: each key is a path of the
 * document, and `partialFilterExpression` is checked like a filter.
 */
export type IndexesCheck<S, I> = { [N in keyof I]: IndexCheck<S, I[N]> }
