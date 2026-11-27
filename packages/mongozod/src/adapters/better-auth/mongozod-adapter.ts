import type { AnyModel } from '../../plugins/plugin'
import type { WhereFields } from './where'
import type { BetterAuthOptions } from 'better-auth'
import type {
  AdapterFactoryConfig,
  AdapterFactoryCustomizeAdapterCreator,
  CleanedWhere,
  CustomAdapter,
  DBAdapter,
  DBTransactionAdapter,
  JoinConfig
} from 'better-auth/adapters'
import type { ClientSession, Db, Document, MongoClient } from 'mongodb'

import { createLogger } from 'better-auth'
import { createAdapterFactory } from 'better-auth/adapters'
import { MongoError, MongoErrorLabel, MongoServerError, ObjectId } from 'mongodb'

import { checkModels } from './check-models'
import { idsOf, idToString } from './ids'
import { betterAuthIndexes, indexBuilds } from './indexes'
import { runWithSession } from './transaction-session'
import { toFilter } from './where'

/** The arguments Better Auth passes to a method of the adapter. */
type Args<K extends Exclude<keyof CustomAdapter, 'createSchema' | 'options'>> = Parameters<
  NonNullable<CustomAdapter[K]>
>[0]

/** The tables of Better Auth, with the names of its own ones suggested. */
type Table = 'account' | 'session' | 'user' | 'verification' | (string & {})

/**
 * What the adapter runs on: a model of mongozod or a collection of the driver, whose methods have
 * the same names and arguments.
 */
interface Target {
  countDocuments(filter: Document, options: Document): Promise<number>
  deleteMany(filter: Document, options: Document): Promise<{ deletedCount: number }>
  deleteOne(filter: Document, options: Document): Promise<unknown>
  find(filter: Document, options: Document): { toArray(): Promise<Document[]> }
  findOne(filter: Document, options: Document): Promise<Document | null>
  findOneAndDelete(filter: Document, options: Document): Promise<Document | null>
  findOneAndUpdate(filter: Document, update: Document, options: Document): Promise<Document | null>
  insertOne(document: Document, options: Document): Promise<{ insertedId: unknown }>
  updateMany(
    filter: Document,
    update: Document,
    options: Document
  ): Promise<{ modifiedCount: number }>
}

/** The options of `mongozodAdapter()`. */
export interface MongozodAdapterOptions {
  /**
   * The `MongoClient` of `db`, which turns transactions on, as in the official adapter. Without it,
   * Better Auth runs the operations of a request one after the other. MongoDB only has transactions
   * in a replica set or a sharded cluster: on a standalone server, leave it out.
   */
  client?: MongoClient
  /** The database of the tables without a model. */
  db: Db
  /**
   * The models of mongozod, by the name of their Better Auth table, such as `user` or
   * `organization`: their reads and writes go through the model and its plugins. The other tables
   * go through the collections of `db`, as in the official adapter. The schema of each model
   * declares `_id` and every field Better Auth writes in its table.
   */
  models?: Partial<Record<Table, AnyModel>>
}

/** The ISO 8601 dates that Better Auth's `safeJSONParse` turns into `Date`s. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

/** NoSuchTransaction (251) and TransactionCommitted (256): the server has nothing open to abort. */
const ABORT_SETTLED_CODES = new Set([251, 256])

/**
 * Aborts a transaction whose commit did not complete, as the official adapter does, so it does not
 * stay open until `transactionLifetimeLimitSeconds`. A retryable error is tried once more, and the
 * rest is logged: the error of the request is the one that surfaces.
 */
async function abortTransaction(
  client: MongoClient,
  session: ClientSession,
  logger: ReturnType<typeof createLogger>
) {
  for (let attempt = 0; ; attempt++) {
    try {
      // oxlint-disable-next-line no-await-in-loop
      await client.db('admin').command({ abortTransaction: 1 }, { session })

      return
    } catch (error) {
      if (error instanceof MongoServerError && ABORT_SETTLED_CODES.has(Number(error.code))) return

      const retryable =
        error instanceof MongoError && error.hasErrorLabel(MongoErrorLabel.RetryableWriteError)

      if (retryable && attempt === 0) continue

      logger.error('Failed to abort a MongoDB transaction whose commit did not complete', error)

      return
    }
  }
}

/**
 * A Better Auth database adapter whose reads and writes go through the models of mongozod, so their
 * plugins, such as `softDelete`, apply to Better Auth too. The tables without a model go through
 * the collections of `db`, as in the official MongoDB adapter, which this one replaces.
 *
 * @example
 *   import { betterAuth } from 'better-auth'
 *   import { mongozodAdapter } from 'mongozod/adapters/better-auth'
 *
 *   export const auth = betterAuth({
 *     database: mongozodAdapter({
 *       client,
 *       db,
 *       models: { organization: OrganizationsModel, user: UsersModel }
 *     })
 *   })
 *
 * @see https://mongozod.dev/docs/adapters/better-auth
 */
export function mongozodAdapter({ client, db, models = {} }: MongozodAdapterOptions) {
  const builds = indexBuilds()
  const routed = (modelKey: string) => models[modelKey] !== undefined

  const creator =
    (session?: ClientSession): AdapterFactoryCustomizeAdapterCreator =>
    ({ getFieldAttributes, getFieldName, getModelName, options, schema }): CustomAdapter => {
      // The adapter of a transaction comes from an instance already checked.
      if (!session) checkModels(models, schema)

      const ids = idsOf(options)
      const indexes = betterAuthIndexes(
        { build: !session, db, logger: options.logger, modelName: getModelName, routed, schema },
        builds
      )
      const sessionOptions = { session }

      function targetOf(model: string, modelKey: string): Target {
        return models[modelKey] ?? db.collection(model)
      }

      function storeId(value: unknown): unknown {
        if (ids.custom || value === null || value === undefined) return value
        if (typeof value === 'string') return ids.parse(value) ?? value
        if (ids.isId(value)) return value
        if (Array.isArray(value)) return value.map(storeId)

        throw new Error('Invalid id value')
      }

      function fieldsOf(modelKey: string): WhereFields {
        return {
          // Better Auth passes the id as `_id` once `mapKeysTransformInput` maps it.
          holdsId: (field) =>
            field === 'id' ||
            field === '_id' ||
            getFieldAttributes({ field, model: modelKey }).references?.field === 'id',
          name(field) {
            const name = getFieldName({ field, model: modelKey })

            return name === 'id' ? '_id' : name
          },
          storeId
        }
      }

      function filterOf(modelKey: string, where?: readonly CleanedWhere[]) {
        return toFilter(where, fieldsOf(modelKey))
      }

      /** The projection of a `select`, with the fields its joins read. */
      function projectionOf(modelKey: string, select?: readonly string[], join?: JoinConfig) {
        if (!select?.length) return undefined

        const fields = fieldsOf(modelKey)
        const joined = Object.values(join ?? {}).map(({ on }) => on.from)

        return Object.fromEntries([...select, ...joined].map((field) => [fields.name(field), 1]))
      }

      /**
       * The documents of each join, read through the model or the collection of the joined table,
       * as Better Auth does when the adapter has no joins of its own: a model's plugins skip its
       * documents, as `softDelete` skips the deleted ones.
       */
      async function withJoins(modelKey: string, document: Document, join?: JoinConfig) {
        const joined: Document = { ...document }

        for (const [joinedModel, config] of Object.entries(join ?? {})) {
          const joinedKey = config.modelKey ?? joinedModel
          const value = document[fieldsOf(modelKey).name(config.on.from)]
          const target = targetOf(joinedModel, joinedKey)
          const filter = { [fieldsOf(joinedKey).name(config.on.to)]: value }
          const oneToOne = config.relation === 'one-to-one'

          // One at a time: the operations of a transaction share its session.
          if (value === null || value === undefined) joined[joinedModel] = oneToOne ? null : []
          // oxlint-disable-next-line no-await-in-loop
          else if (oneToOne) joined[joinedModel] = await target.findOne(filter, sessionOptions)
          else {
            const limit = config.limit ?? options.advanced?.database?.defaultFindManyLimit ?? 100

            // oxlint-disable-next-line no-await-in-loop
            joined[joinedModel] = await target.find(filter, { limit, session }).toArray()
          }
        }

        return joined
      }

      async function count({ model, modelKey = model, where }: Args<'count'>) {
        indexes.retry()

        return targetOf(model, modelKey).countDocuments(filterOf(modelKey, where), sessionOptions)
      }

      // Better Auth types the results with a type argument of the caller, as each adapter does.
      async function create<T extends Document>(args: Args<'create'> & { data: T }): Promise<T>
      async function create({ data, model, modelKey = model }: Args<'create'>) {
        indexes.retry()
        await indexes.table(modelKey)

        const result = await targetOf(model, modelKey).insertOne(data, sessionOptions)

        // A model returns the stored document, with its defaults and transforms.
        return 'document' in result ? result.document : { ...data, _id: result.insertedId }
      }

      async function consumeOne<T>(args: Args<'consumeOne'>): Promise<T | null>
      async function consumeOne({ model, modelKey = model, where }: Args<'consumeOne'>) {
        indexes.retry()

        return targetOf(model, modelKey).findOneAndDelete(filterOf(modelKey, where), sessionOptions)
      }

      async function deleteOne({ model, modelKey = model, where }: Args<'delete'>) {
        indexes.retry()
        await targetOf(model, modelKey).deleteOne(filterOf(modelKey, where), sessionOptions)
      }

      async function deleteMany({ model, modelKey = model, where }: Args<'deleteMany'>) {
        indexes.retry()

        const result = await targetOf(model, modelKey).deleteMany(
          filterOf(modelKey, where),
          sessionOptions
        )

        return result.deletedCount
      }

      async function findMany<T>(args: Args<'findMany'>): Promise<T[]>
      async function findMany({
        join,
        limit,
        model,
        modelKey = model,
        offset,
        select,
        sortBy,
        where
      }: Args<'findMany'>) {
        indexes.retry()

        const findOptions: Document = { session }
        const projection = projectionOf(modelKey, select, join)

        if (projection) findOptions.projection = projection
        if (sortBy) {
          findOptions.sort = {
            [fieldsOf(modelKey).name(sortBy.field)]: sortBy.direction === 'desc' ? -1 : 1
          }
        }
        if (offset) findOptions.skip = offset
        if (limit) findOptions.limit = limit

        const documents = await targetOf(model, modelKey)
          .find(filterOf(modelKey, where), findOptions)
          .toArray()

        if (!join) return documents

        const joined: Document[] = []

        // One at a time, as the joins of each document.
        // oxlint-disable-next-line no-await-in-loop
        for (const document of documents) joined.push(await withJoins(modelKey, document, join))

        return joined
      }

      async function findOne<T>(args: Args<'findOne'>): Promise<T | null>
      async function findOne({ join, model, modelKey = model, select, where }: Args<'findOne'>) {
        indexes.retry()

        const findOptions: Document = { session }
        const projection = projectionOf(modelKey, select, join)

        if (projection) findOptions.projection = projection

        const document = await targetOf(model, modelKey).findOne(
          filterOf(modelKey, where),
          findOptions
        )

        return document && withJoins(modelKey, document, join)
      }

      async function incrementOne<T>(args: Args<'incrementOne'>): Promise<T | null>
      async function incrementOne({
        increment,
        model,
        modelKey = model,
        set,
        where
      }: Args<'incrementOne'>) {
        indexes.retry()
        await indexes.table(modelKey)

        const target = targetOf(model, modelKey)
        const filter = filterOf(modelKey, where)
        const update: Document = {}

        if (Object.keys(increment).length > 0) update.$inc = increment
        if (set && Object.keys(set).length > 0) update.$set = set
        if (!update.$inc && !update.$set) return target.findOne(filter, sessionOptions)

        return target.findOneAndUpdate(filter, update, { returnDocument: 'after', session })
      }

      async function update<T>(args: Args<'update'> & { update: T }): Promise<T | null>
      async function update({ model, modelKey = model, update: values, where }: Args<'update'>) {
        indexes.retry()
        await indexes.table(modelKey)

        return targetOf(model, modelKey).findOneAndUpdate(
          filterOf(modelKey, where),
          { $set: values },
          { returnDocument: 'after', session }
        )
      }

      async function updateMany({
        model,
        modelKey = model,
        update: values,
        where
      }: Args<'updateMany'>) {
        indexes.retry()
        await indexes.table(modelKey)

        const result = await targetOf(model, modelKey).updateMany(
          filterOf(modelKey, where),
          { $set: values },
          sessionOptions
        )

        return result.modifiedCount
      }

      return {
        consumeOne,
        count,
        create,
        delete: deleteOne,
        deleteMany,
        findMany,
        findOne,
        incrementOne,
        update,
        updateMany
      }
    }

  const config: AdapterFactoryConfig = {
    adapterId: 'mongozod',
    adapterName: 'mongozod',
    // Like the official adapter: a string of a new `ObjectId`, which the transform stores as one.
    customIdGenerator: () => new ObjectId().toString(),
    customTransformInput({ action, data, field, fieldAttributes, options }) {
      if (field !== '_id' && fieldAttributes.references?.field !== 'id') return data

      const ids = idsOf(options)

      if (ids.custom || (action !== 'create' && action !== 'update')) return data
      if (ids.isId(data)) return data
      if (Array.isArray(data)) {
        return data.map((item) => (typeof item === 'string' ? (ids.parse(item) ?? item) : item))
      }
      if (typeof data === 'string') return ids.parse(data) ?? data
      if (
        fieldAttributes.references?.field === 'id' &&
        !fieldAttributes.required &&
        data === null
      ) {
        return null
      }
      if (action === 'update') return data

      return ids.generate()
    },
    customTransformOutput({ data, field, fieldAttributes }) {
      // Backward compatibility: a `json` field stored as text, as the official adapter stores it,
      // reads as its value, as Better Auth reads it with `supportsJSON: false` (`safeJSONParse`,
      // which also turns ISO dates into `Date`s). A write of the field stores the value. A string
      // that is not JSON stays as it is.
      if (fieldAttributes.type === 'json' && typeof data === 'string') {
        try {
          return JSON.parse(data, (_, value: unknown) =>
            typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))
              ? new Date(value)
              : value
          )
        } catch (error) {
          if (error instanceof SyntaxError) return data

          throw error
        }
      }
      if (field !== 'id' && fieldAttributes.references?.field !== 'id') return data

      return Array.isArray(data) ? data.map(idToString) : idToString(data)
    },
    mapKeysTransformInput: { id: '_id' },
    mapKeysTransformOutput: { _id: 'id' },
    supportsArrays: true,
    // MongoDB stores a `json` field as a value, which a model's schema takes, such as a `z.object()`.
    supportsJSON: true,
    supportsNumericIds: false
  }

  return (options: BetterAuthOptions): DBAdapter => {
    async function transaction<R>(
      transactionClient: MongoClient,
      callback: (adapter: DBTransactionAdapter) => Promise<R>
    ): Promise<R> {
      const session = transactionClient.startSession()
      let commitAttempted = false

      try {
        const adapter = createAdapterFactory({
          adapter: creator(session),
          config: { ...config, transaction: false }
        })(options)

        // `withTransaction` runs the callback again when MongoDB aborts the transaction for a
        // transient error, such as a write conflict.
        return await session.withTransaction(async () => {
          commitAttempted = false

          const result = await runWithSession(session, () => callback(adapter))

          commitAttempted = true

          return result
        })
      } catch (error) {
        if (commitAttempted) {
          await abortTransaction(transactionClient, session, createLogger(options.logger))
        }

        throw error
      } finally {
        await session.endSession()
      }
    }

    return createAdapterFactory({
      adapter: creator(),
      config: {
        ...config,
        transaction: client ? (callback) => transaction(client, callback) : false
      }
    })(options)
  }
}
