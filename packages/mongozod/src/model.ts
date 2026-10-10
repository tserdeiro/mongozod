import type { FilterCheck, SuggestedFilter } from './filter'
import type { ModelCursor } from './model-cursor'
import type { ModelFindCursor } from './model-find-cursor'
import type { PathSuggestions } from './path-suggestions'
import type { PipelineCheck } from './pipeline'
import type { FieldAt, NotAPath } from './schema-at'
import type { SortCheck, SuggestedSort } from './sort'
import type {
  ArrayFiltersEntriesCheck,
  SuggestedUpdate,
  UpdateCheck,
  UpdateOptionsCheck
} from './update'
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

/** Driver options whose `sort` is checked against the schema, with the keys the editor suggests. */
type Sorted<S, O, Sort> = Omit<O, 'sort'> & { sort?: Sort & SuggestedSort<S> }

/** Driver options of an update, whose `arrayFilters` and `sort` `UpdateOptionsCheck` checks. */
type UpdateOptionsBase<O> = Omit<O, 'arrayFilters' | 'sort'> & {
  arrayFilters?: ReadonlyArray<Document>
  sort?: Document
}

/**
 * A `distinct` key: a path of the document, suggested by the editor. A `string` key matches no
 * suggestion, so it does not compile.
 */
type DistinctKey<S, K extends string> =
  | PathSuggestions<S, 'filter'>
  | '_id'
  | (string extends K ? never : [FieldAt<S, K, 'filter'>] extends [never] ? NotAPath<K> : K)

/** An `updateOne` or `updateMany` of `bulkWrite`, checked like the operation of the same name. */
type BulkUpdateCheck<
  S extends ModelSchema,
  Base,
  M extends { filter: unknown; update: unknown }
> = Omit<Base, 'arrayFilters' | 'filter' | 'update'> & {
  arrayFilters?: M extends { arrayFilters: infer AF }
    ? ArrayFiltersEntriesCheck<S, M['update'], AF>
    : never
  filter: FilterCheck<S, M['filter']>
  update: UpdateCheck<S, M['update'], M['filter'], M>
}

/**
 * One `bulkWrite` operation: filters and updates are checked, and inserts and replacements take the
 * input.
 */
type BulkWriteOperationCheck<S extends ModelSchema, O> = O extends { insertOne: unknown }
  ? { insertOne: { document: Input<S> } }
  : O extends { replaceOne: { filter: infer F } }
    ? {
        replaceOne: Omit<ReplaceOneModel<Output<S>>, 'filter' | 'replacement'> & {
          filter: FilterCheck<S, F>
          replacement: Input<S>
        }
      }
    : O extends { updateOne: infer M extends { filter: unknown; update: unknown } }
      ? { updateOne: BulkUpdateCheck<S, UpdateOneModel<Output<S>>, M> }
      : O extends { updateMany: infer M extends { filter: unknown; update: unknown } }
        ? { updateMany: BulkUpdateCheck<S, UpdateManyModel<Output<S>>, M> }
        : O extends { deleteOne: { filter: infer F } }
          ? { deleteOne: Omit<DeleteOneModel<Output<S>>, 'filter'> & { filter: FilterCheck<S, F> } }
          : O extends { deleteMany: { filter: infer F } }
            ? {
                deleteMany: Omit<DeleteManyModel<Output<S>>, 'filter'> & {
                  filter: FilterCheck<S, F>
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
  countDocuments<const F extends FilterCheck<S, F>>(
    filter?: F & SuggestedFilter<S>,
    options?: CountDocumentsOptions & Abortable
  ): Promise<number>

  /** Deletes every document that matches the filter. */
  deleteMany<const F extends FilterCheck<S, F>>(
    filter?: F & SuggestedFilter<S>,
    options?: DeleteOptions
  ): Promise<DeleteResult>

  /** Deletes the first document that matches the filter. */
  deleteOne<const F extends FilterCheck<S, F>>(
    filter?: F & SuggestedFilter<S>,
    options?: DeleteOptions
  ): Promise<DeleteResult>

  /** The distinct values of a path among the documents that match the filter. */
  distinct<const K extends string, const F extends FilterCheck<S, F>>(
    key: K & DistinctKey<S, K>,
    filter?: F & SuggestedFilter<S>,
    options?: DistinctOptions
  ): Promise<Array<Exclude<Flatten<core.output<FieldAt<S, K, 'filter'>>>, undefined>>>

  /** Estimates the number of documents from the collection's metadata. */
  estimatedDocumentCount(options?: EstimatedDocumentCountOptions): Promise<number>

  /**
   * Finds the documents that match the filter. The cursor can be awaited for the array, iterated
   * with `for await` and chained like the driver's.
   */
  find<const F extends FilterCheck<S, F>, const Sort extends SortCheck<S, Sort>>(
    filter?: F & SuggestedFilter<S>,
    options?: Sorted<S, FindOptions, Sort> & Abortable
  ): ModelFindCursor<WithId<Output<S>>, S>

  /** Finds the first document that matches the filter. */
  findOne<const F extends FilterCheck<S, F>, const Sort extends SortCheck<S, Sort>>(
    filter?: F & SuggestedFilter<S>,
    options?: Sorted<S, Omit<FindOneOptions, 'timeoutMode'>, Sort> & Abortable
  ): Promise<WithId<Output<S>> | null>

  /** Deletes the first document that matches the filter and returns it. */
  findOneAndDelete<const F extends FilterCheck<S, F>, const Sort extends SortCheck<S, Sort>>(
    filter: F & SuggestedFilter<S>,
    options: Sorted<S, FindOneAndDeleteOptions, Sort> & { includeResultMetadata: true }
  ): Promise<ModifyResult<Output<S>>>
  findOneAndDelete<const F extends FilterCheck<S, F>, const Sort extends SortCheck<S, Sort>>(
    filter: F & SuggestedFilter<S>,
    options?: Sorted<S, FindOneAndDeleteOptions, Sort>
  ): Promise<WithId<Output<S>> | null>

  /** Replaces the first document that matches the filter, validated like `replaceOne`. */
  findOneAndReplace<const F extends FilterCheck<S, F>, const Sort extends SortCheck<S, Sort>>(
    filter: F & SuggestedFilter<S>,
    replacement: Input<S>,
    options: Sorted<S, FindOneAndReplaceOptions, Sort> & { includeResultMetadata: true }
  ): Promise<ModifyResult<Output<S>>>
  findOneAndReplace<const F extends FilterCheck<S, F>, const Sort extends SortCheck<S, Sort>>(
    filter: F & SuggestedFilter<S>,
    replacement: Input<S>,
    options?: Sorted<S, FindOneAndReplaceOptions, Sort>
  ): Promise<WithId<Output<S>> | null>

  /** Updates the first document that matches the filter and returns it. */
  findOneAndUpdate<
    const F extends FilterCheck<S, F>,
    const U extends UpdateCheck<S, U, F, O>,
    const O extends UpdateOptionsBase<FindOneAndUpdateOptions> & UpdateOptionsCheck<S, U, O>
  >(
    filter: F & SuggestedFilter<S>,
    update: U & SuggestedUpdate<S>,
    options: O & { includeResultMetadata: true }
  ): Promise<ModifyResult<Output<S>>>
  findOneAndUpdate<
    const F extends FilterCheck<S, F>,
    const U extends UpdateCheck<S, U, F, O>,
    const O extends UpdateOptionsBase<FindOneAndUpdateOptions> & UpdateOptionsCheck<S, U, O>
  >(
    filter: F & SuggestedFilter<S>,
    update: U & SuggestedUpdate<S>,
    options?: O
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
  replaceOne<const F extends FilterCheck<S, F>, const Sort extends SortCheck<S, Sort>>(
    filter: F & SuggestedFilter<S>,
    replacement: Input<S>,
    options?: Sorted<S, ReplaceOptions, Sort>
  ): Promise<UpdateResult<Output<S>>>

  /** Updates every document that matches the filter. */
  updateMany<
    const F extends FilterCheck<S, F>,
    const U extends UpdateCheck<S, U, F, O>,
    const O extends UpdateOptionsBase<UpdateOptions> & UpdateOptionsCheck<S, U, O>
  >(
    filter: F & SuggestedFilter<S>,
    update: U & SuggestedUpdate<S>,
    options?: O
  ): Promise<UpdateResult<Output<S>>>

  /** Updates the first document that matches the filter. */
  updateOne<
    const F extends FilterCheck<S, F>,
    const U extends UpdateCheck<S, U, F, O>,
    const O extends UpdateOptionsBase<UpdateOptions> & UpdateOptionsCheck<S, U, O>
  >(
    filter: F & SuggestedFilter<S>,
    update: U & SuggestedUpdate<S>,
    options?: O
  ): Promise<UpdateResult<Output<S>>>
}
