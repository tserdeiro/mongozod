import type { ModelCursor } from './model-cursor'
import type { ModelFindCursor } from './model-find-cursor'
import type {
  Abortable,
  AggregateOptions,
  AnyBulkWriteOperation,
  BulkWriteOptions,
  BulkWriteResult,
  Collection,
  CountDocumentsOptions,
  Db,
  DeleteOptions,
  DeleteResult,
  DistinctOptions,
  Document,
  EstimatedDocumentCountOptions,
  Filter,
  FindOneAndDeleteOptions,
  FindOneAndReplaceOptions,
  FindOneAndUpdateOptions,
  FindOneOptions,
  FindOptions,
  Flatten,
  InsertManyResult,
  InsertOneOptions,
  InsertOneResult,
  ModifyResult,
  ReplaceOneModel,
  ReplaceOptions,
  Sort,
  UpdateFilter,
  UpdateOptions,
  UpdateResult,
  WithId
} from 'mongodb'
import type * as core from 'zod/v4/core'

/**
 * The schema of a model: a `z.object`, or a `z.discriminatedUnion` of objects for a collection that
 * stores several types of document. Zod Classic and Zod Mini schemas are both accepted.
 */
export type ModelSchema = core.$ZodObject | core.$ZodDiscriminatedUnion<readonly core.$ZodObject[]>

/** A document as stored: the output of the schema. */
export type Output<S extends ModelSchema> = Extract<core.output<S>, Document>

/** A document to write: the input of the schema. */
export type Input<S extends ModelSchema> = core.input<S>

/** A `bulkWrite` operation: inserts and replacements take the input of the schema. */
export type ModelBulkWriteOperation<S extends ModelSchema> =
  | { insertOne: { document: Input<S> } }
  | { replaceOne: Omit<ReplaceOneModel<Output<S>>, 'replacement'> & { replacement: Input<S> } }
  | Exclude<AnyBulkWriteOperation<Output<S>>, { insertOne: unknown } | { replaceOne: unknown }>

/**
 * A model: the driver's operations on one collection, with the schema validating what is written
 * and typing what is read.
 */
export interface Model<S extends ModelSchema> {
  /** The schema of each document. */
  readonly schema: S

  /** The name of the collection. */
  readonly name: string

  /** The driver's database, resolved on first use. */
  readonly db: Db

  /** The driver's collection, for what the model does not wrap, such as `watch`. */
  readonly collection: Collection<Output<S>>

  /**
   * Runs an aggregation pipeline. With `schema`, each document is validated with it and typed by
   * it; without it, documents are returned as the driver returns them.
   */
  aggregate<R extends core.$ZodType>(
    pipeline: Document[],
    options: AggregateOptions & Abortable & { schema: R }
  ): ModelCursor<core.output<R>>
  aggregate(pipeline?: Document[], options?: AggregateOptions & Abortable): ModelCursor<Document>

  /** Runs several writes in one command. Inserts and replacements are validated like `insertOne`. */
  bulkWrite(
    operations: ReadonlyArray<ModelBulkWriteOperation<S>>,
    options?: BulkWriteOptions
  ): Promise<BulkWriteResult>

  /** Counts the documents that match the filter. */
  countDocuments(
    filter?: Filter<Output<S>>,
    options?: CountDocumentsOptions & Abortable
  ): Promise<number>

  /** Deletes every document that matches the filter. */
  deleteMany(filter?: Filter<Output<S>>, options?: DeleteOptions): Promise<DeleteResult>

  /** Deletes the first document that matches the filter. */
  deleteOne(filter?: Filter<Output<S>>, options?: DeleteOptions): Promise<DeleteResult>

  /** The distinct values of a field among the documents that match the filter. */
  distinct<K extends keyof WithId<Output<S>>>(
    key: K,
    filter?: Filter<Output<S>>,
    options?: DistinctOptions
  ): Promise<Array<Flatten<WithId<Output<S>>[K]>>>

  /** Estimates the number of documents from the collection's metadata. */
  estimatedDocumentCount(options?: EstimatedDocumentCountOptions): Promise<number>

  /**
   * Finds the documents that match the filter. The cursor can be awaited for the array, iterated
   * with `for await` and chained like the driver's.
   */
  find(
    filter?: Filter<Output<S>>,
    options?: FindOptions & Abortable
  ): ModelFindCursor<WithId<Output<S>>>

  /** Finds the first document that matches the filter. */
  findOne(
    filter?: Filter<Output<S>>,
    options?: Omit<FindOneOptions, 'timeoutMode'> & Abortable
  ): Promise<WithId<Output<S>> | null>

  /** Deletes the first document that matches the filter and returns it. */
  findOneAndDelete(
    filter: Filter<Output<S>>,
    options: FindOneAndDeleteOptions & { includeResultMetadata: true }
  ): Promise<ModifyResult<Output<S>>>
  findOneAndDelete(
    filter: Filter<Output<S>>,
    options?: FindOneAndDeleteOptions
  ): Promise<WithId<Output<S>> | null>

  /** Replaces the first document that matches the filter, validated like `replaceOne`. */
  findOneAndReplace(
    filter: Filter<Output<S>>,
    replacement: Input<S>,
    options: FindOneAndReplaceOptions & { includeResultMetadata: true }
  ): Promise<ModifyResult<Output<S>>>
  findOneAndReplace(
    filter: Filter<Output<S>>,
    replacement: Input<S>,
    options?: FindOneAndReplaceOptions
  ): Promise<WithId<Output<S>> | null>

  /** Updates the first document that matches the filter and returns it. */
  findOneAndUpdate(
    filter: Filter<Output<S>>,
    update: UpdateFilter<Output<S>> | Document[],
    options: FindOneAndUpdateOptions & { includeResultMetadata: true }
  ): Promise<ModifyResult<Output<S>>>
  findOneAndUpdate(
    filter: Filter<Output<S>>,
    update: UpdateFilter<Output<S>> | Document[],
    options?: FindOneAndUpdateOptions
  ): Promise<WithId<Output<S>> | null>

  /**
   * Validates the documents with the schema and inserts them. Returns the driver's result plus the
   * stored `documents`, with their defaults and transforms applied.
   */
  insertMany(
    documents: ReadonlyArray<Input<S>>,
    options?: BulkWriteOptions
  ): Promise<InsertManyResult<Output<S>> & { documents: Array<WithId<Output<S>>> }>

  /**
   * Validates the document with the schema and inserts it. Returns the driver's result plus the
   * stored `document`, with its defaults and transforms applied.
   */
  insertOne(
    document: Input<S>,
    options?: InsertOneOptions
  ): Promise<InsertOneResult<Output<S>> & { document: WithId<Output<S>> }>

  /**
   * Replaces the first document that matches the filter. The replacement is validated like an
   * insert, and its `_id` is written only when given: the one a `.default()` generates is dropped,
   * because the `_id` of a document cannot change.
   */
  replaceOne(
    filter: Filter<Output<S>>,
    replacement: Input<S>,
    options?: ReplaceOptions
  ): Promise<UpdateResult<Output<S>>>

  /** Updates every document that matches the filter. */
  updateMany(
    filter: Filter<Output<S>>,
    update: UpdateFilter<Output<S>> | Document[],
    options?: UpdateOptions
  ): Promise<UpdateResult<Output<S>>>

  /** Updates the first document that matches the filter. */
  updateOne(
    filter: Filter<Output<S>>,
    update: UpdateFilter<Output<S>> | Document[],
    options?: UpdateOptions & { sort?: Sort }
  ): Promise<UpdateResult<Output<S>>>
}
