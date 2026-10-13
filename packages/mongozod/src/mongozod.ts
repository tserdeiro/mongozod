import type { IndexFunction } from './model/indexes'
import type { JsonSchemaOption } from './model/json-schema'
import type { Model, ModelSchema, None, SyncResult } from './model/model'
import type { FindArgs } from './model/model-find-cursor'
import type { ReadContext, ReadPlan } from './model/read-plan'
import type {
  Timestamps,
  TimestampNamesOf,
  TimestampsCheck,
  TimestampsOption
} from './model/timestamps'
import type { PluginsCheck } from './plugins/check'
import type { BatchSource } from './plugins/pipeline'
import type { AnyPlugin, Operation, PluginMethods } from './plugins/plugin'
import type { ReferenceTarget, References, UnknownReferences } from './references/references'
import type { Virtuals, VirtualsCheck } from './references/virtuals'
import type {
  Abortable,
  AggregateOptions,
  AnyBulkWriteOperation,
  Collection,
  Db,
  Document,
  IndexDescription,
  ModifyResult,
  WithId
} from 'mongodb'

import { AsyncLocalStorage } from 'node:async_hooks'

import { MongoServerError } from 'mongodb'
import { z } from 'zod'
import * as core from 'zod/v4/core'

import { checkFieldNames } from './model/check-field-names'
import { checkFilter } from './model/check-filter'
import { checkRoot } from './model/check-root'
import { checkStoredTypes } from './model/check-stored-types'
import { indexesOf } from './model/indexes'
import { toJsonSchema } from './model/json-schema'
import { batchSource, inContext, ModelCursor } from './model/model-cursor'
import { ModelFindCursor } from './model/model-find-cursor'
import { parseDocument } from './model/parse-document'
import { parseEach } from './model/parse-each'
import { planRead } from './model/read-plan'
import { stampDocument, stampPipeline, stampUpdate, timestampsOf } from './model/timestamps'
import { checkPlugins, runCursor, runOperation } from './plugins/pipeline'
import { checkReferences, registerFind } from './references/references'
import { virtualsOf } from './references/virtuals'
import { findPath } from './schema/find-path'
import { schemaAt } from './schema/schema-at'
import { parseUpdate } from './updates/parse-update'
import { filterEqualities, nullIdIssue } from './updates/upsert'

/**
 * The options of `mongozod()`.
 *
 * @see https://mongozod.dev/docs/api/mongozod#mongozodoptions
 */
export interface MongozodOptions<
  S extends ModelSchema,
  T extends TimestampsOption = false,
  V = None,
  R = None,
  PL extends readonly AnyPlugin[] = []
> {
  /** The name of the collection. */
  collection: string

  /**
   * The driver's database, or a function that returns it. The function is called on every
   * operation, so the model can be defined before the connection is ready, and it can return the
   * database of each request, such as a tenant's from an `AsyncLocalStorage`: keep a `Db` per
   * tenant, since `client.db(name)` builds a new one each time. A cursor runs in the async context
   * it is created in, like a promise: read after its request, it still reads the tenant's
   * database, also for `populate` and the hooks of the plugins, and one created outside of a
   * request reads the default database, even when read inside one.
   */
  db: Db | (() => Db)

  /**
   * The indexes that `sync()` creates, declared with `index(key, options)` like the driver's
   * `createIndex`: each key is a path of the document, and `partialFilterExpression` is checked
   * like a filter. A callback, so that the editor suggests the paths.
   *
   * @example
   *   indexes: (index) => [index({ organization: 1, createdAt: -1 }), index({ slug: 1 }, { unique: true })]
   */
  indexes?: (index: IndexFunction<S>) => readonly IndexDescription[]

  /**
   * Applies a `$jsonSchema` generated from the schema when `sync()` runs, so that the server also
   * checks the structure of each document: `true`, or the validation level and action.
   */
  jsonSchema?: JsonSchemaOption

  /**
   * The plugins of the model, in layers: the first wraps the rest, so its `before` hooks run first
   * and its `after` hooks last.
   *
   * @example
   *   plugins: [softDelete()]
   */
  plugins?: PL

  /**
   * The fields that store the `_id` of another document, or an array of them, which `populate`
   * replaces with the documents, also inside objects and arrays of objects, such as
   * `items.product`. Each one points to a function that returns another model, so that its plugins
   * and virtuals apply, or to a collection and its schema, for one without a model. A one-to-many
   * reference is a key that is not a field, with the documents of another model whose
   * `foreignField` stores this document's `localField`, `_id` by default, like MongoDB's `$lookup`.
   *
   * @example
   *   references: {
   *   'items.product': () => ProductsModel,
   *   'organization': { collection: 'organizations', schema },
   *   'posts': { model: () => PostsModel, foreignField: 'author' }
   *   }
   */
  references?: R & UnknownReferences<S, R>

  /**
   * The schema of each document as stored: a `z.object`, or a `z.discriminatedUnion` of objects or
   * of other discriminated unions.
   * The `_id` is generated by its `.default()`; without one, the driver generates an `ObjectId`.
   * A `z.bigint()` needs a client or a `Db` with `useBigInt64: true`, or every operation throws an
   * `Error`: without it, the driver reads a long as a number. The driver reads back neither a
   * `Set` nor a `Map`, so a set is `mz.set()`, an array without repeats, and a map is `z.record()`.
   * An async refinement that queries the database runs without the session of a transaction, so it
   * reads outside of it: a check that has to see the transaction goes in a plugin's `before` hook,
   * which gets the `session` in its options.
   */
  schema: S

  /**
   * Writes `createdAt` when a document is created and `updatedAt` on every write, like Mongoose:
   * `true`, or an object that renames each field or turns it off with `false`. The schema declares
   * them, taking a `Date`, and inserts take them as optional: an operation with `timestamps: false`
   * gives them. Off by default.
   *
   * @example
   *   import * as mz from 'mongozod/mzod'
   *
   *   const noteSchema = z.object({
   *     title: z.string(),
   *     createdAt: mz.date(),
   *     updatedAt: mz.date()
   *   })
   */
  timestamps?: T

  /**
   * Fields computed from others, which reads add and the database does not store. Each one is a
   * schema that picks the fields it reads and transforms them into its value. A projection that
   * asks for one also asks the server for those fields, and returns only what it asked for.
   *
   * @example
   *   fullName: accountSchema
   *     .pick({ firstName: true, lastName: true })
   *     .transform((account) => `${account.firstName} ${account.lastName}`)
   */
  virtuals?: V
}

/** Whether the server answered that the collection does not exist. */
function isNamespaceNotFound(error: unknown) {
  return error instanceof MongoServerError && error.code === 26
}

/**
 * Runs a `findOneAnd…` with its metadata, processes its document and returns what the options
 * ask for, like the driver: the `ModifyResult`, or its document.
 */
async function findOneAnd(
  plan: ReadPlan,
  driverOptions: Document,
  run: (options: Document & { includeResultMetadata: true }) => Promise<ModifyResult>
): Promise<ModifyResult | WithId<Document> | null> {
  const result = await run({ ...driverOptions, includeResultMetadata: true })

  if (result.value && plan.process) await plan.process([result.value])

  return driverOptions.includeResultMetadata ? result : result.value
}

/** The read options that Mongoose takes as strings, with an example of the object they take. */
const STRING_OPTIONS = { projection: '{ name: 1 }', sort: '{ createdAt: -1 }' }

/**
 * Defines the model of a collection, with the schema as the single source of truth: it validates
 * what is written and types what is read.
 *
 * @example
 *   export const NotesModel = mongozod({
 *     collection: 'notes',
 *     db: client.db(),
 *     schema: noteSchema
 *   })
 *
 *   const { document } = await NotesModel.insertOne({ organization, title })
 *
 * @example
 *   // A transaction is the driver's: each operation takes its session, or it runs outside of it.
 *   await client.withSession((session) =>
 *     session.withTransaction(async () => {
 *       await AccountsModel.updateOne({ _id: from }, { $inc: { balance: -amount } }, { session })
 *       await AccountsModel.updateOne({ _id: to }, { $inc: { balance: amount } }, { session })
 *     })
 *   )
 *
 * @see https://mongozod.dev/docs/api/mongozod#mongozod
 */
export function mongozod<
  S extends ModelSchema,
  const T extends TimestampsOption = false,
  // oxlint-disable-next-line typescript/no-generated-empty-object-type -- empty only without virtuals
  const V extends VirtualsCheck<S, V> = None,
  // oxlint-disable-next-line typescript/no-generated-empty-object-type -- keyed by the fields of the schema
  const R extends References<S> = None,
  const PL extends readonly AnyPlugin[] = []
>(
  options: MongozodOptions<S, T, V, R, PL> & TimestampsCheck<S, T> & PluginsCheck<S, PL>
): Model<S, TimestampNamesOf<T>, V, R, PL> & PluginMethods<PL>
// The implementation works with plain documents: the signature above types them with the schema.
export function mongozod(
  options: Omit<MongozodOptions<ModelSchema, TimestampsOption>, 'indexes' | 'plugins'> & {
    indexes?: Parameters<typeof indexesOf>[1]
    plugins?: readonly AnyPlugin[]
    references?: Record<string, ReferenceTarget>
    virtuals?: Virtuals
  }
): Model<ModelSchema> {
  checkRoot(options.schema)
  checkFieldNames(options.schema)
  checkStoredTypes(options.schema)
  checkReferences(options.schema, options.references)

  const plugins = options.plugins ?? []

  checkPlugins(options.schema, plugins)

  const indexes = indexesOf(options.schema, options.indexes)

  const timestamps = timestampsOf(options.schema, options.timestamps)

  // A function is called on every operation, so it can return the database of each request, such
  // as a tenant's.
  function getDb() {
    return typeof options.db === 'function' ? options.db() : options.db
  }

  // The driver reads a long as a number, or as a `Long` past 2^53, unless the client sets
  // `useBigInt64`: a `z.bigint()` would type reads with a value they do not have.
  const bigint = findPath(options.schema, (field) => field instanceof core.$ZodBigInt)

  // The collection of each database, kept once it passes the check.
  const collections = new WeakMap<Db, Collection>()

  function getCollection(db = getDb()) {
    const kept = collections.get(db)

    if (kept) return kept

    const collection = db.collection(options.collection)

    // Checked before keeping it, so that every operation throws, not only the first one.
    if (bigint !== undefined && !collection.bsonOptions.useBigInt64) {
      throw new Error(
        `"${bigint}" is a z.bigint(), which the driver reads as a number unless the client sets useBigInt64: true`
      )
    }

    collections.set(db, collection)

    return collection
  }

  const declaresId = schemaAt(options.schema, '_id', 'filter').length > 0

  const context: ReadContext = {
    db: getDb,
    references: options.references ?? {},
    virtuals: virtualsOf(options.schema, options.virtuals)
  }

  /**
   * Plans a read and splits its options: `populate` is mongozod's, the rest go to the driver. The
   * reads of `populate` share the session and the context of the operation.
   */
  function readOptions(operationOptions: Document = {}, operationContext?: unknown, db = getDb()) {
    const { populate, ...driverOptions } = operationOptions

    // Mongoose takes these as strings; the driver would sort by a field named like the string.
    const issues: core.$ZodIssue[] = Object.entries(STRING_OPTIONS)
      .filter(([option]) => typeof driverOptions[option] === 'string')
      .map(([option, example]) => ({
        code: 'custom',
        input: driverOptions[option],
        message: `${option} takes an object such as ${example}, not a string`,
        path: [option]
      }))

    if (issues.length > 0) throw new z.ZodRealError(issues)

    const plan = planRead({ ...context, db: () => db }, driverOptions.projection, populate, {
      context: operationContext,
      session: driverOptions.session
    })

    if (plan.projection) driverOptions.projection = plan.projection

    return { driverOptions, plan, populate }
  }

  /**
   * The options for the driver, without mongozod's: the fields the operation stamps, and whether an
   * update may be a pipeline.
   */
  function writeOptions(operationOptions: Document = {}) {
    const { timestamps: stamp, updatePipeline, ...driverOptions } = operationOptions

    return {
      driverOptions,
      pipeline: updatePipeline === true,
      stamps: stamp === false ? {} : timestamps
    }
  }

  /**
   * Validates a replacement like an insert, keeping the `_id` only when it is given. An upsert
   * validates the document it would insert: the replacement with the `_id` of the filter.
   */
  async function parseReplacement(
    filter: Document,
    replacement: Document,
    upsert: unknown,
    stamps: Timestamps,
    now: Date
  ) {
    const nullId = upsert ? nullIdIssue(filter) : undefined

    if (nullId) throw new z.ZodRealError([nullId])

    const filterId = filterEqualities(filter).get('_id')

    // An upsert inserts the replacement with the `_id` of the filter, or the server's ObjectId.
    if (upsert && declaresId && replacement._id === undefined && filterId === undefined) {
      throw new z.ZodRealError([
        {
          code: 'custom',
          input: filter,
          message:
            'an upsert of a replacement needs the _id in its filter: the server would insert an ObjectId',
          path: ['_id']
        }
      ])
    }

    const inserted =
      upsert && replacement._id === undefined && filterId !== undefined
        ? { ...replacement, _id: filterId }
        : replacement
    const document = await parseDocument(
      options.schema,
      stampDocument(inserted, stamps, now, 'replacement')
    )

    // The `_id` of a document cannot change, so the one a `.default()` generates, or the filter's,
    // is dropped, as Mongoose skips it on replacements.
    if (replacement._id === undefined) delete document._id

    return document
  }

  /**
   * Stamps an update and validates it with the schema, given its filter and its options. A pipeline
   * passes with `updatePipeline: true`, stamped but without validating its values: they are
   * expressions the server computes.
   */
  async function parseModelUpdate(
    filter: Document,
    update: unknown,
    updateOptions: Document,
    { pipeline, stamps }: { pipeline: boolean; stamps: Timestamps },
    now: Date
  ): Promise<Document | Document[]> {
    const { arrayFilters, upsert } = updateOptions

    if (Array.isArray(update)) {
      if (pipeline) return stampPipeline(update, stamps, now, upsert)

      throw new z.ZodRealError([
        {
          code: 'custom',
          input: update,
          message: 'an update with a pipeline needs updatePipeline: true',
          path: []
        }
      ])
    }

    return parseUpdate(options.schema, filter, stampUpdate(update, stamps, now, upsert), {
      arrayFilters,
      upsert
    })
  }

  /** Runs an operation through the plugins of the model. */
  function operate<R>(
    operation: Operation,
    args: Document,
    run: (args: Document) => Promise<R>
  ): Promise<R> {
    return runOperation({ model, plugins }, operation, args, (coreArgs) => {
      // The filter the plugins leave, before the driver sends it.
      if (coreArgs.filter !== undefined) checkFilter(coreArgs.filter)

      return run(coreArgs)
    })
  }

  function openAggregate(args: Document): BatchSource<unknown> {
    const { schema, ...driverOptions } = args.options
    const cursor = getCollection().aggregate([...args.pipeline], driverOptions)

    if (!schema) return batchSource(cursor, (batch) => batch)

    // Each batch at once, asynchronously, as the writes: a refinement of the schema may be async.
    return batchSource(cursor, (batch) =>
      Promise.all(batch.map((document) => z.parseAsync(schema, document)))
    )
  }

  function openFind(args: Document): BatchSource<Document> {
    checkFilter(args.filter)

    const db = getDb()
    const { driverOptions, plan } = readOptions(args.options, args.context, db)
    const cursor = getCollection(db).find<Document>(args.filter, driverOptions)

    return batchSource(cursor, plan.process ?? ((batch) => batch))
  }

  function aggregate<R extends core.$ZodType>(
    stages: readonly Document[],
    aggregateOptions: AggregateOptions & Abortable & { schema: R }
  ): ModelCursor<core.output<R>>
  function aggregate(
    stages?: readonly Document[],
    aggregateOptions?: AggregateOptions & Abortable
  ): ModelCursor<Document>
  function aggregate(stages: readonly Document[] = [], aggregateOptions: Document = {}) {
    const args = { options: { ...aggregateOptions }, pipeline: [...stages] }
    const restore = AsyncLocalStorage.snapshot()

    return new ModelCursor(() =>
      inContext(restore, () => runCursor({ model, plugins }, 'aggregate', args, openAggregate))
    )
  }

  // The operations that return documents have several signatures, like the driver's. TypeScript
  // then compares them with the interface's erasing its type parameters, which the projected
  // result depends on.
  function find(): ModelFindCursor<Document>
  function find(filter: Document, findOptions?: Document): ModelFindCursor<Document>
  function find(filter: Document = {}, findOptions: Document = {}) {
    const restore = AsyncLocalStorage.snapshot()

    return new ModelFindCursor({ filter, options: { ...findOptions } }, <T>(args: FindArgs) =>
      inContext(restore, () => runCursor<T>({ model, plugins }, 'find', { ...args }, openFind))
    )
  }

  function findOne(): Promise<WithId<Document> | null>
  function findOne(filter: Document, findOptions?: Document): Promise<WithId<Document> | null>
  function findOne(filter: Document = {}, findOptions: Document = {}) {
    return operate('findOne', { filter, options: findOptions }, async (args) => {
      const { driverOptions, plan } = readOptions(args.options, args.context)
      const document = await getCollection().findOne(args.filter, driverOptions)

      if (document && plan.process) await plan.process([document])

      return document
    })
  }

  function findOneAndDelete(
    filter: Document,
    deleteOptions: Document & { includeResultMetadata: true }
  ): Promise<ModifyResult>
  function findOneAndDelete(
    filter: Document,
    deleteOptions?: Document
  ): Promise<WithId<Document> | null>
  function findOneAndDelete(
    filter: Document,
    deleteOptions: Document = {}
  ): Promise<ModifyResult | WithId<Document> | null> {
    return operate('findOneAndDelete', { filter, options: deleteOptions }, (args) => {
      const { driverOptions, plan } = readOptions(args.options, args.context)

      return findOneAnd(plan, driverOptions, (metadataOptions) =>
        getCollection().findOneAndDelete(args.filter, metadataOptions)
      )
    })
  }

  function findOneAndReplace(
    filter: Document,
    replacement: Document,
    replaceOptions: Document & { includeResultMetadata: true }
  ): Promise<ModifyResult>
  function findOneAndReplace(
    filter: Document,
    replacement: Document,
    replaceOptions?: Document
  ): Promise<WithId<Document> | null>
  function findOneAndReplace(
    filter: Document,
    replacement: Document,
    replaceOptions: Document = {}
  ): Promise<ModifyResult | WithId<Document> | null> {
    const operationArgs = { filter, options: replaceOptions, replacement }

    return operate('findOneAndReplace', operationArgs, async (args) => {
      const { driverOptions: writeDriverOptions, stamps } = writeOptions(args.options)
      const { driverOptions, plan } = readOptions(writeDriverOptions, args.context)
      const document = await parseReplacement(
        args.filter,
        args.replacement,
        driverOptions.upsert,
        stamps,
        new Date()
      )

      return findOneAnd(plan, driverOptions, (metadataOptions) =>
        getCollection().findOneAndReplace(args.filter, document, metadataOptions)
      )
    })
  }

  function findOneAndUpdate(
    filter: Document,
    update: Document,
    updateOptions: Document & { includeResultMetadata: true }
  ): Promise<ModifyResult>
  function findOneAndUpdate(
    filter: Document,
    update: Document,
    updateOptions?: Document
  ): Promise<WithId<Document> | null>
  function findOneAndUpdate(
    filter: Document,
    update: Document,
    updateOptions: Document = {}
  ): Promise<ModifyResult | WithId<Document> | null> {
    return operate('findOneAndUpdate', { filter, options: updateOptions, update }, async (args) => {
      const { driverOptions: writeDriverOptions, ...write } = writeOptions(args.options)
      const { driverOptions, plan } = readOptions(writeDriverOptions, args.context)
      const parsed = await parseModelUpdate(
        args.filter,
        args.update,
        driverOptions,
        write,
        new Date()
      )

      return findOneAnd(plan, driverOptions, (metadataOptions) =>
        getCollection().findOneAndUpdate(args.filter, parsed, metadataOptions)
      )
    })
  }

  /** Validates the operations of a `bulkWrite` like the operations of the same name. */
  function parseBulkWrite(
    operations: readonly Document[],
    write: { pipeline: boolean; stamps: Timestamps },
    now: Date
  ): Promise<AnyBulkWriteOperation[]> {
    const { stamps } = write

    return parseEach(operations, async (operation): Promise<AnyBulkWriteOperation> => {
      for (const kind of ['deleteMany', 'deleteOne', 'replaceOne', 'updateMany', 'updateOne']) {
        if (kind in operation) checkFilter(operation[kind].filter)
      }

      if ('insertOne' in operation) {
        const document = stampDocument(operation.insertOne.document, stamps, now)

        return { insertOne: { document: await parseDocument(options.schema, document) } }
      }

      if ('replaceOne' in operation) {
        const { filter, replacement, upsert } = operation.replaceOne

        return {
          replaceOne: {
            ...operation.replaceOne,
            replacement: await parseReplacement(filter, replacement, upsert, stamps, now)
          }
        }
      }

      if ('updateOne' in operation) {
        const { filter, update } = operation.updateOne

        return {
          updateOne: {
            ...operation.updateOne,
            update: await parseModelUpdate(filter, update, operation.updateOne, write, now)
          }
        }
      }

      if ('updateMany' in operation) {
        const { filter, update } = operation.updateMany

        return {
          updateMany: {
            ...operation.updateMany,
            update: await parseModelUpdate(filter, update, operation.updateMany, write, now)
          }
        }
      }

      if ('deleteOne' in operation) return { deleteOne: operation.deleteOne }

      return { deleteMany: operation.deleteMany }
    })
  }

  const model = {
    get collection() {
      return getCollection()
    },
    get db() {
      return getDb()
    },
    name: options.collection,
    schema: options.schema,
    references: options.references ?? {},
    virtuals: options.virtuals ?? {},

    aggregate,

    bulkWrite(operations: readonly Document[], bulkOptions: Document = {}) {
      return operate(
        'bulkWrite',
        { operations: [...operations], options: bulkOptions },
        async (args) => {
          const { driverOptions, ...write } = writeOptions(args.options)

          return getCollection().bulkWrite(
            await parseBulkWrite(args.operations, write, new Date()),
            driverOptions
          )
        }
      )
    },

    countDocuments(filter: Document = {}, countOptions: Document = {}) {
      return operate('countDocuments', { filter, options: countOptions }, (args) =>
        getCollection().countDocuments(args.filter, args.options)
      )
    },

    deleteMany(filter: Document = {}, deleteOptions: Document = {}) {
      return operate('deleteMany', { filter, options: deleteOptions }, (args) =>
        getCollection().deleteMany(args.filter, args.options)
      )
    },

    deleteOne(filter: Document = {}, deleteOptions: Document = {}) {
      return operate('deleteOne', { filter, options: deleteOptions }, (args) =>
        getCollection().deleteOne(args.filter, args.options)
      )
    },

    distinct(key: string, filter: Document = {}, distinctOptions: Document = {}) {
      return operate('distinct', { filter, key, options: distinctOptions }, (args) =>
        getCollection().distinct(args.key, args.filter, args.options)
      )
    },

    estimatedDocumentCount(countOptions: Document = {}) {
      return operate('estimatedDocumentCount', { options: countOptions }, (args) =>
        getCollection().estimatedDocumentCount(args.options)
      )
    },

    find,
    findOne,
    findOneAndDelete,
    findOneAndReplace,
    findOneAndUpdate,

    insertMany(inputs: readonly Document[], insertOptions: Document = {}) {
      return operate(
        'insertMany',
        { documents: [...inputs], options: insertOptions },
        async (args) => {
          const { driverOptions, stamps } = writeOptions(args.options)
          const now = new Date()
          const documents = await parseEach(args.documents, (input: Document) =>
            parseDocument(options.schema, stampDocument(input, stamps, now))
          )
          const result = await getCollection().insertMany(documents, driverOptions)

          return {
            ...result,
            // `insertedIds` maps the index of each document to its `_id`, generated or not.
            documents: Object.values(result.insertedIds).map((_id, index) =>
              Object.assign({ _id }, documents[index])
            )
          }
        }
      )
    },

    insertOne(input: Document, insertOptions: Document = {}) {
      return operate('insertOne', { document: input, options: insertOptions }, async (args) => {
        const { driverOptions, stamps } = writeOptions(args.options)
        const document = await parseDocument(
          options.schema,
          stampDocument(args.document, stamps, new Date())
        )
        const result = await getCollection().insertOne(document, driverOptions)

        return { ...result, document: { _id: result.insertedId, ...document } }
      })
    },

    replaceOne(filter: Document, replacement: Document, replaceOptions: Document = {}) {
      const operationArgs = { filter, options: replaceOptions, replacement }

      return operate('replaceOne', operationArgs, async (args) => {
        const { driverOptions, stamps } = writeOptions(args.options)
        const document = await parseReplacement(
          args.filter,
          args.replacement,
          driverOptions.upsert,
          stamps,
          new Date()
        )

        return getCollection().replaceOne(args.filter, document, driverOptions)
      })
    },

    async sync(): Promise<SyncResult> {
      if (options.jsonSchema) {
        const validation: Document =
          typeof options.jsonSchema === 'object' ? { ...options.jsonSchema } : {}

        validation.validator = { $jsonSchema: toJsonSchema(options.schema) }
        validation.validationLevel ??= 'strict'
        validation.validationAction ??= 'error'

        try {
          await getDb().command({ collMod: options.collection, ...validation })
        } catch (error) {
          // `collMod` needs the collection: create it with the validator.
          if (!isNamespaceNotFound(error)) throw error

          await getDb().createCollection(options.collection, validation)
        }
      }

      const names = indexes.length > 0 ? await getCollection().createIndexes(indexes) : []
      const existing = await getCollection()
        .indexes()
        .catch((error: unknown) => {
          // A collection without indexes or a validator may not exist yet.
          if (isNamespaceNotFound(error)) return []

          throw error
        })

      // MongoDB creates an index on the metaField and the timeField of a time-series collection.
      const [info] = await getDb()
        .listCollections({ name: options.collection }, { nameOnly: false })
        .toArray()
      const timeseries: Document | undefined = info?.options?.timeseries
      const automatic =
        timeseries?.metaField &&
        JSON.stringify({ [timeseries.metaField]: 1, [timeseries.timeField]: 1 })

      return {
        extraIndexes: existing.filter(
          (index) =>
            index.name !== '_id_' &&
            !names.includes(index.name ?? '') &&
            JSON.stringify(index.key) !== automatic
        ),
        indexes: names
      }
    },

    updateMany(filter: Document, update: Document, updateOptions: Document = {}) {
      return operate('updateMany', { filter, options: updateOptions, update }, async (args) => {
        const { driverOptions, ...write } = writeOptions(args.options)
        const parsed = await parseModelUpdate(
          args.filter,
          args.update,
          driverOptions,
          write,
          new Date()
        )

        return getCollection().updateMany(args.filter, parsed, driverOptions)
      })
    },

    updateOne(filter: Document, update: Document, updateOptions: Document = {}) {
      return operate('updateOne', { filter, options: updateOptions, update }, async (args) => {
        const { driverOptions, ...write } = writeOptions(args.options)
        const parsed = await parseModelUpdate(
          args.filter,
          args.update,
          driverOptions,
          write,
          new Date()
        )

        return getCollection().updateOne(args.filter, parsed, driverOptions)
      })
    }
  }

  // The methods of the plugins use `this`, which is the model when they are called on it.
  for (const plugin of plugins) {
    for (const [name, method] of Object.entries(plugin.methods ?? {})) {
      if (Object.hasOwn(model, name))
        throw new Error(`${plugin.id}: "${name}" is a member of the model`)

      Object.assign(model, { [name]: method })
    }
  }

  registerFind(model, find)

  return model
}
