import type { Db } from 'mongodb'

import { definePlugin } from './plugin'

/** The index builds started, by database and collection: a tenant's database builds its own. */
const builds = new WeakMap<Db, Map<string, Promise<unknown>>>()

/**
 * Creates the indexes a model declares on its first operation in each database, as Mongoose's
 * `autoIndex` does, for development, tests and serverless platforms without a step that runs
 * `sync()` before the app takes requests. The first operations wait for one `createIndexes`, which
 * does nothing when the indexes exist. It creates the indexes only: a `$jsonSchema` needs
 * `collMod`, which an application's `readWrite` user cannot run, so `sync()` applies it.
 *
 * When the build fails, such as a unique index over repeated values, the operation that started it
 * throws the server's error, and the next operation tries again.
 *
 * @example
 *   export const RunsModel = mongozod({
 *     collection: 'runs',
 *     db,
 *     indexes: (index) => [index({ routine: 1, slot: 1 }, { unique: true })],
 *     plugins: [autoIndex()],
 *     schema: runSchema
 *   })
 *
 * @see https://mongozod.dev/docs/plugins/auto-index
 */
export function autoIndex() {
  return definePlugin({
    id: 'autoIndex',

    async middleware({ model, next }) {
      if (model.indexes.length > 0) {
        const { db, name } = model
        let collections = builds.get(db)

        if (!collections) {
          collections = new Map()
          builds.set(db, collections)
        }

        let build = collections.get(name)

        if (!build) {
          build = model.collection.createIndexes([...model.indexes]).catch((error: unknown) => {
            // Forget the failed build, so that the next operation tries again.
            collections.delete(name)

            throw error
          })
          collections.set(name, build)
        }

        await build
      }

      return next()
    }
  })
}
