import type { AbstractCursor } from 'mongodb'

/**
 * A driver cursor that can also be awaited for the array of its documents.
 *
 * `await` and `toArray()` read every document at once, and `for await` reads them batch by batch,
 * as the server returns them.
 */
export class ModelCursor<T> implements AsyncIterable<T>, PromiseLike<T[]> {
  readonly #cursor: AbstractCursor<T>

  constructor(cursor: AbstractCursor<T>) {
    this.#cursor = cursor
  }

  /** Reads every document. The cursor is exhausted afterwards. */
  toArray(): Promise<T[]> {
    return this.#cursor.toArray()
  }

  /** Frees the cursor on the server before it is exhausted. */
  close(): Promise<void> {
    return this.#cursor.close()
  }

  [Symbol.asyncIterator](): AsyncGenerator<T, void, void> {
    return this.#cursor[Symbol.asyncIterator]()
  }

  /** Makes the cursor awaitable: `await cursor` is `await cursor.toArray()`. */
  // oxlint-disable-next-line unicorn/no-thenable -- being awaitable is the point: `await find()` gives the array
  then<R1 = T[], R2 = never>(
    onfulfilled?: ((documents: T[]) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    return this.toArray().then(onfulfilled, onrejected)
  }
}
