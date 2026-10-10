import type { ModelSchema } from './model'
import type { ModelSort } from './sort'
import type { Document, FindCursor, Sort } from 'mongodb'

import { ModelCursor } from './model-cursor'

/**
 * The cursor of `find`: chains `sort`, `limit`, `skip` and `project` like the driver's
 * `FindCursor`, and can be awaited for the array of its documents. The other modifiers go in the
 * options of `find`. `S` is the schema of the model, which checks the keys of `sort`.
 */
export class ModelFindCursor<T, S extends ModelSchema = ModelSchema> extends ModelCursor<T> {
  readonly #cursor: FindCursor<T>

  constructor(cursor: FindCursor<T>) {
    super(cursor)
    this.#cursor = cursor
  }

  /** Sets the sort order, with the keys checked against the schema. */
  sort<const SortSpec extends ModelSort<S, SortSpec>>(sort: SortSpec): this
  sort(sort: Sort): this {
    // oxlint-disable-next-line unicorn/no-array-sort -- the driver's cursor method, not `Array#sort`
    this.#cursor.sort(sort)

    return this
  }

  /** Sets the maximum number of documents to return. */
  limit(value: number): this {
    this.#cursor.limit(value)

    return this
  }

  /** Sets the number of documents to skip. */
  skip(value: number): this {
    this.#cursor.skip(value)

    return this
  }

  /** Sets the projection, like the driver's `FindCursor.project`. */
  project<P extends Document = Document>(projection: Document): ModelFindCursor<P, S> {
    return new ModelFindCursor(this.#cursor.project<P>(projection))
  }
}
