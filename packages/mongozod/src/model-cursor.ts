import type { AbstractCursor, Document } from 'mongodb'

/**
 * Reads a driver cursor batch by batch, as the server returns them, and runs `process` once per
 * batch, such as to populate its references with one query. Like the driver's `for await`, it
 * closes the cursor when the loop ends early.
 */
export async function* processBatches(
  cursor: AbstractCursor<Document>,
  process: (batch: Document[]) => Promise<Document[]>
): AsyncGenerator<Document[], void, void> {
  try {
    // `hasNext` fetches the next batch when the buffer is empty, so the batches come one by one.
    // oxlint-disable-next-line eslint/no-await-in-loop -- each batch is read after the previous one
    while (await cursor.hasNext()) yield await process(cursor.readBufferedDocuments())
  } finally {
    if (!cursor.closed) await cursor.close()
  }
}

/**
 * A driver cursor that can also be awaited for the array of its documents.
 *
 * `await` and `toArray()` read every document at once, and `for await` reads them batch by batch,
 * as the server returns them. `batches`, when given, reads the batches instead of the cursor, such
 * as the ones `processBatches` returns.
 */
export class ModelCursor<T> implements AsyncIterable<T>, PromiseLike<T[]> {
  readonly #cursor: AbstractCursor<T>
  readonly #batches: (() => AsyncIterable<T[]>) | undefined

  constructor(cursor: AbstractCursor<T>, batches?: () => AsyncIterable<T[]>) {
    this.#cursor = cursor
    this.#batches = batches
  }

  /** Reads every document. The cursor is exhausted afterwards. */
  async toArray(): Promise<T[]> {
    if (!this.#batches) return this.#cursor.toArray()

    const documents: T[] = []

    for await (const document of this) documents.push(document)

    return documents
  }

  /** Frees the cursor on the server before it is exhausted. */
  close(): Promise<void> {
    return this.#cursor.close()
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, void> {
    if (!this.#batches) {
      yield* this.#cursor

      return
    }

    for await (const batch of this.#batches()) yield* batch
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
