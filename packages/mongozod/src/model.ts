import type { ModelFilter } from './filter'
import type { ModelCursor } from './model-cursor'
import type { ModelFindCursor } from './model-find-cursor'
import type { PathSuggestions } from './path-suggestions'
import type { PipelineCheck } from './pipeline'
import type { FieldAt, NotAPath } from './schema-at'
import type { ModelSort } from './sort'
import type {
  Abortable,
  AggregateOptions,
  BulkWriteOptions,
  BulkWriteResult,
  Collection,
  CountDocumentsOptions,
  Db,
  DeleteManyModel,
  DeleteOneModel,
  DeleteOptions,
  DeleteResult,
  DistinctOptions,
  Document,
  EstimatedDocumentCountOptions,
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
  UpdateFilter,
  UpdateManyModel,
  UpdateOneModel,
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

/** Driver options whose `sort` is checked against the schema. */
type Sorted<O, Sort> = Omit<O, 'sort'> & { sort?: Sort }

/**
 * A `distinct` key: a path of the document, suggested by the editor. A `string` key matches no
 * suggestion, so it does not compile.
 */
type DistinctKey<S, K extends string> =
  | PathSuggestions<S, 'filter'>
  | '_id'
  | (string extends K ? never : [FieldAt<S, K, 'filter'>] extends [never] ? NotAPath<K> : K)

/** One `bulkWrite` operation: filters are checked, and inserts and replacements take the input. */
type BulkWriteOperationCheck<S extends ModelSchema, O> = O extends { insertOne: unknown }
  ? { insertOne: { document: Input<S> } }
  : O extends { replaceOne: { filter: infer F } }
    ? {
        replaceOne: Omit<ReplaceOneModel<Output<S>>, 'filter' | 'replacement'> & {
          filter: ModelFilter<S, F>
          replacement: Input<S>
        }
      }
    : O extends { updateOne: { filter: infer F } }
      ? { updateOne: Omit<UpdateOneModel<Output<S>>, 'filter'> & { filter: ModelFilter<S, F> } }
      : O extends { updateMany: { filter: infer F } }
        ? { updateMany: Omit<UpdateManyModel<Output<S>>, 'filter'> & { filter: ModelFilter<S, F> } }
        : O extends { deleteOne: { filter: infer F } }
          ? { deleteOne: Omit<DeleteOneModel<Output<S>>, 'filter'> & { filter: ModelFilter<S, F> } }
          : O extends { deleteMany: { filter: infer F } }
            ? {
                deleteMany: Omit<DeleteManyModel<Output<S>>, 'filter'> & {
                  filter: ModelFilter<S, F>
                }
              }
            : 'an operation is insertOne, replaceOne, updateOne, updateMany, deleteOne or deleteMany'

/** Checks the operations of a `bulkWrite` one by one. */
export type BulkWriteCheck<S extends ModelSchema, Operations> = {
  [I in keyof Operations]: BulkWriteOperationCheck<S, Operations[I]>
}

/**
 * A model: the driver's operations on one collection, with the schema validating what is written
 * and typing what is read. Filters, sorts and the `$match` stages of a pipeline are checked key by
 * key against the schema.
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
   * it; without it, documents are returned as the driver returns them. The `$match` stages before
   * the first stage that reshapes the documents are checked like a filter.
   */
  aggregate<const P extends PipelineCheck<S, P>, R extends core.$ZodType>(
    pipeline: P,
    options: AggregateOptions & Abortable & { schema: R }
  ): ModelCursor<core.output<R>>
  aggregate<const P extends PipelineCheck<S, P> = []>(
    pipeline?: P,
    options?: AggregateOptions & Abortable
  ): ModelCursor<Document>

  /** Runs several writes in one command. Inserts and replacements are validated like `insertOne`. */
  bulkWrite<const Operations extends ReadonlyArray<Document> & BulkWriteCheck<S, Operations>>(
    operations: Operations,
    options?: BulkWriteOptions
  ): Promise<BulkWriteResult>

  /** Counts the documents that match the filter. */
  countDocuments<const F extends ModelFilter<S, F>>(
    filter?: F,
    options?: CountDocumentsOptions & Abortable
  ): Promise<number>

  /** Deletes every document that matches the filter. */
  deleteMany<const F extends ModelFilter<S, F>>(
    filter?: F,
    options?: DeleteOptions
  ): Promise<DeleteResult>

  /** Deletes the first document that matches the filter. */
  deleteOne<const F extends ModelFilter<S, F>>(
    filter?: F,
    options?: DeleteOptions
  ): Promise<DeleteResult>

  /** The distinct values of a path among the documents that match the filter. */
  distinct<const K extends string, const F extends ModelFilter<S, F>>(
    key: K & DistinctKey<S, K>,
    filter?: F,
    options?: DistinctOptions
  ): Promise<Array<Exclude<Flatten<core.output<FieldAt<S, K, 'filter'>>>, undefined>>>

  /** Estimates the number of documents from the collection's metadata. */
  estimatedDocumentCount(options?: EstimatedDocumentCountOptions): Promise<number>

  /**
   * Finds the documents that match the filter. The cursor can be awaited for the array, iterated
   * with `for await` and chained like the driver's.
   */
  find<const F extends ModelFilter<S, F>, const Sort extends ModelSort<S, Sort>>(
    filter?: F,
    options?: Sorted<FindOptions, Sort> & Abortable
  ): ModelFindCursor<WithId<Output<S>>, S>

  /** Finds the first document that matches the filter. */
  findOne<const F extends ModelFilter<S, F>, const Sort extends ModelSort<S, Sort>>(
    filter?: F,
    options?: Sorted<Omit<FindOneOptions, 'timeoutMode'>, Sort> & Abortable
  ): Promise<WithId<Output<S>> | null>

  /** Deletes the first document that matches the filter and returns it. */
  findOneAndDelete<const F extends ModelFilter<S, F>, const Sort extends ModelSort<S, Sort>>(
    filter: F,
    options: Sorted<FindOneAndDeleteOptions, Sort> & { includeResultMetadata: true }
  ): Promise<ModifyResult<Output<S>>>
  findOneAndDelete<const F extends ModelFilter<S, F>, const Sort extends ModelSort<S, Sort>>(
    filter: F,
    options?: Sorted<FindOneAndDeleteOptions, Sort>
  ): Promise<WithId<Output<S>> | null>

  /** Replaces the first document that matches the filter, validated like `replaceOne`. */
  findOneAndReplace<const F extends ModelFilter<S, F>, const Sort extends ModelSort<S, Sort>>(
    filter: F,
    replacement: Input<S>,
    options: Sorted<FindOneAndReplaceOptions, Sort> & { includeResultMetadata: true }
  ): Promise<ModifyResult<Output<S>>>
  findOneAndReplace<const F extends ModelFilter<S, F>, const Sort extends ModelSort<S, Sort>>(
    filter: F,
    replacement: Input<S>,
    options?: Sorted<FindOneAndReplaceOptions, Sort>
  ): Promise<WithId<Output<S>> | null>

  /** Updates the first document that matches the filter and returns it. */
  findOneAndUpdate<const F extends ModelFilter<S, F>, const Sort extends ModelSort<S, Sort>>(
    filter: F,
    update: UpdateFilter<Output<S>> | Document[],
    options: Sorted<FindOneAndUpdateOptions, Sort> & { includeResultMetadata: true }
  ): Promise<ModifyResult<Output<S>>>
  findOneAndUpdate<const F extends ModelFilter<S, F>, const Sort extends ModelSort<S, Sort>>(
    filter: F,
    update: UpdateFilter<Output<S>> | Document[],
    options?: Sorted<FindOneAndUpdateOptions, Sort>
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
  replaceOne<const F extends ModelFilter<S, F>, const Sort extends ModelSort<S, Sort>>(
    filter: F,
    replacement: Input<S>,
    options?: Sorted<ReplaceOptions, Sort>
  ): Promise<UpdateResult<Output<S>>>

  /** Updates every document that matches the filter. */
  updateMany<const F extends ModelFilter<S, F>>(
    filter: F,
    update: UpdateFilter<Output<S>> | Document[],
    options?: UpdateOptions
  ): Promise<UpdateResult<Output<S>>>

  /** Updates the first document that matches the filter. */
  updateOne<const F extends ModelFilter<S, F>, const Sort extends ModelSort<S, Sort>>(
    filter: F,
    update: UpdateFilter<Output<S>> | Document[],
    options?: UpdateOptions & { sort?: Sort }
  ): Promise<UpdateResult<Output<S>>>
}
