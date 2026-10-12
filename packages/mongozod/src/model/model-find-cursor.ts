import type { ProjectionCheck, SuggestedProjection } from '../types/projection'
import type { SortCheck, SuggestedSort } from '../types/sort'
import type { IsAny, NotAString } from '../utils/type-helpers'
import type { ModelSchema, None, ReadDocument, SortProblem } from './model'
import type { Document, Sort } from 'mongodb'

import { ModelCursor } from './model-cursor'

/** A projection that leaves out a reference the read populates does not compile. */
type KeepsPopulated<P, Pop> = {
  [K in keyof P & keyof Pop]?: IsAny<P[K]> extends true
    ? unknown
    : [P[K]] extends [0 | false]
      ? `populate needs "${K & string}": the projection excludes it`
      : unknown
}

/** The arguments of a `find`, which the modifiers of its cursor change before it starts. */
export interface FindArgs {
  filter: Document
  options: Document
}

/** Starts a `find` with its arguments, and gives the batches of documents as their type. */
export type FindOpener = <T>(args: FindArgs) => AsyncGenerator<T[], void, void>

/**
 * The cursor of `find`: chains `sort`, `limit`, `skip` and `project` like the driver's
 * `FindCursor`, and can be awaited for the array of its documents. The other modifiers go in the
 * options of `find`. `S` is the schema of the model, `V` its virtuals and `R` its references, which
 * check the keys of `sort` and `project`, `Pop` the `populate` of the read and `Found` the types of
 * document its filter allows.
 *
 * The modifiers set the options of `find`, which the plugins see when the cursor starts: after it
 * starts, they throw an `Error`, like the driver's.
 */
export class ModelFindCursor<
  T,
  S extends ModelSchema = ModelSchema,
  V = None,
  R = None,
  Pop = None,
  Found extends ModelSchema = S
> extends ModelCursor<T> {
  readonly #args: FindArgs
  readonly #open: FindOpener

  constructor(args: FindArgs, open: FindOpener) {
    super(() => open<T>(args))
    this.#args = args
    this.#open = open
  }

  #set(option: string, value: unknown): this {
    if (this.started) throw new Error(`the cursor already started: set ${option} before reading it`)

    this.#args.options[option] = value

    return this
  }

  /** Sets the sort order, with the keys checked against the schema. */
  sort<const SortSpec extends SortCheck<S, SortSpec>>(
    sort: SortSpec & SuggestedSort<S> & NotAString<SortSpec, SortProblem>
  ): this
  sort(sort: Sort): this {
    return this.#set('sort', sort)
  }

  /** Sets the maximum number of documents to return. */
  limit(value: number): this {
    return this.#set('limit', value)
  }

  /** Sets the number of documents to skip. */
  skip(value: number): this {
    return this.#set('skip', value)
  }

  /**
   * Sets the projection, checked against the schema, and types the documents it returns. Like the
   * driver's, it replaces the projection of `find`.
   */
  project<const P extends ProjectionCheck<S, P, V>>(
    projection: P & SuggestedProjection<S, V> & KeepsPopulated<P, Pop>
  ): ModelFindCursor<ReadDocument<Found, V, R, P, Pop>, S, V, R, Pop, Found>
  project(projection: Document): ModelFindCursor<Document, S, V, R, Pop, Found> {
    if (this.started) throw new Error('the cursor already started: set project before reading it')

    const options = { ...this.#args.options, projection }

    return new ModelFindCursor<Document, S, V, R, Pop, Found>(
      { ...this.#args, options },
      this.#open
    )
  }
}
