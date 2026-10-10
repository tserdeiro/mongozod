import type { ModelSchema, None, ReadDocument } from './model'
import type { ProjectionCheck, SuggestedProjection } from './projection'
import type { ReadPlan } from './read-plan'
import type { SortCheck, SuggestedSort } from './sort'
import type { Document, FindCursor, Sort } from 'mongodb'

import { ModelCursor, processBatches } from './model-cursor'

/** A projection that leaves out a reference the read populates does not compile. */
type KeepsPopulated<P, Pop> = {
  [K in keyof P & keyof Pop]: [P[K]] extends [0 | false]
    ? `populate needs "${K & string}": the projection excludes it`
    : unknown
}

/**
 * The cursor of `find`: chains `sort`, `limit`, `skip` and `project` like the driver's
 * `FindCursor`, and can be awaited for the array of its documents. The other modifiers go in the
 * options of `find`. `S` is the schema of the model, `V` its virtuals and `R` its references, which
 * check the keys of `sort` and `project`, and `Pop` the `populate` of the read.
 */
export class ModelFindCursor<
  T,
  S extends ModelSchema = ModelSchema,
  V = None,
  R = None,
  Pop = None
> extends ModelCursor<T> {
  readonly #cursor: FindCursor<T>
  readonly #plan: (projection: Document) => ReadPlan

  /**
   * `plan` plans the projection that `project` sets, with the virtuals and the `populate` of the
   * read. The cursor comes planned: `batches` reads it when it has virtuals or references.
   */
  constructor(
    cursor: FindCursor<T>,
    plan: (projection: Document) => ReadPlan,
    batches?: () => AsyncIterable<T[]>
  ) {
    super(cursor, batches)
    this.#cursor = cursor
    this.#plan = plan
  }

  /** Sets the sort order, with the keys checked against the schema. */
  sort<const SortSpec extends SortCheck<S, SortSpec>>(sort: SortSpec & SuggestedSort<S>): this
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

  /**
   * Sets the projection, checked against the schema, and types the documents it returns. Like the
   * driver's, it replaces the projection of `find`.
   */
  project<const P extends ProjectionCheck<S, P, V>>(
    projection: P & SuggestedProjection<S, V> & KeepsPopulated<P, Pop>
  ): ModelFindCursor<ReadDocument<S, V, R, P, Pop>, S, V, R, Pop>
  project(projection: Document): ModelFindCursor<Document, S, V, R, Pop> {
    const { process, projection: planned } = this.#plan(projection)
    const cursor = this.#cursor.project(planned ?? projection)

    return new ModelFindCursor<Document, S, V, R, Pop>(
      cursor,
      this.#plan,
      process && (() => processBatches(cursor, process))
    )
  }
}
