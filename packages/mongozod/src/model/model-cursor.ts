import type { BatchSource } from '../plugins/pipeline'
import type { AbstractCursor, Document } from 'mongodb'

/**
 * Reads a driver cursor batch by batch, as the server returns them, and runs `process` once per
 * batch, such as to populate its references with one query.
 */
export function batchSource<T>(
  cursor: AbstractCursor<Document>,
  process: (batch: Document[]) => T[] | Promise<T[]>
): BatchSource<T> {
  return {
    async close() {
      if (!cursor.closed) await cursor.close()
    },
    get done() {
      return cursor.closed
    },
    async next() {
      // `hasNext` fetches the next batch when the buffer is empty.
      if (!(await cursor.hasNext())) return []

      return process(cursor.readBufferedDocuments())
    }
  }
}

/**
 * The batches of a cursor, each read in the async context that `restore` runs a function in, the
 * one of the cursor's creation: like a promise, a cursor read after its request still sees the
 * stores of an `AsyncLocalStorage` as they were then, in its plugins and its `populate`.
 */
export async function* inContext<T>(
  restore: <R>(fn: () => R) => R,
  open: () => AsyncGenerator<T[], void, void>
): AsyncGenerator<T[], void, void> {
  const batches = open()

  try {
    for (;;) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- a batch is read after the previous one
      const read = await restore(() => batches.next())

      if (read.done) return

      yield read.value
    }
  } finally {
    await restore(() => batches.return())
  }
}

/**
 * The cursor of `find` and `aggregate`, which can also be awaited for the array of its documents.
 *
 * It starts on the first read: `await` and `toArray()` read every document at once, and `for await`
 * reads them batch by batch, as the server returns them. Like the driver's, it closes the cursor
 * on the server when a loop ends early.
 */
export class ModelCursor<T> implements AsyncIterable<T>, PromiseLike<T[]> {
  readonly #open: () => AsyncGenerator<T[], void, void>
  #batches: AsyncGenerator<T[], void, void> | undefined

  /** `open` starts the cursor and gives its batches, once each is ready. */
  constructor(open: () => AsyncGenerator<T[], void, void>) {
    this.#open = open
  }

  /** Whether the cursor started reading, after which it cannot change. */
  protected get started(): boolean {
    return this.#batches !== undefined
  }

  /** Reads every document. The cursor is exhausted afterwards. */
  async toArray(): Promise<T[]> {
    const documents: T[] = []

    for await (const document of this) documents.push(document)

    return documents
  }

  /** Frees the cursor on the server before it is exhausted. */
  async close(): Promise<void> {
    await this.#batches?.return()
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, void> {
    this.#batches ??= this.#open()

    for await (const batch of this.#batches) yield* batch
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
