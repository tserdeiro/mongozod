import type { FilterCheck, SuggestedFilter } from './filter'
import type { ModelCursor } from './model-cursor'
import type { ModelFindCursor } from './model-find-cursor'
import type { PathSuggestions } from './path-suggestions'
import type { PipelineCheck } from './pipeline'
import type { Projected, ProjectionCheck, SuggestedProjection } from './projection'
import type { FieldAt, NotAPath } from './schema-at'
import type { SortCheck, SuggestedSort } from './sort'
import type { NoTimestamps, TimestampNames, TimestampsOperationOption } from './timestamps'
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

/** Driver options whose `sort` and `projection` are checked against the schema. */
type ReadOptions<S, O, Sort, P> = Omit<O, 'projection' | 'sort'> & {
  projection?: P & SuggestedProjection<S>
  sort?: Sort & SuggestedSort<S>
}

/** The keys the editor suggests in the `sort` and `projection` of options checked elsewhere. */
interface ReadSuggestions<S> {
  projection?: SuggestedProjection<S>
  sort?: SuggestedSort<S>
}

type ProjectionOf<O> = O extends { projection: infer P } ? P : unknown

/** The driver's `ModifyResult`, with the document as the projection returns it. */
type ModifyResultOf<S extends ModelSchema, P> = Omit<ModifyResult<Output<S>>, 'value'> & {
  value: Projected<WithId<Output<S>>, P> | null
}

/** Driver options of an update, whose `arrayFilters` and `sort` `UpdateOptionsCheck` checks. */
type UpdateOptionsBase<O> = Omit<O, 'arrayFilters' | 'projection' | 'sort'> & {
  arrayFilters?: ReadonlyArray<Document>
  projection?: Document
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
  M extends { filter: unknown; update: unknown },
  N extends TimestampNames,
  BulkOptions
> = Omit<Base, 'arrayFilters' | 'filter' | 'update'> & {
  arrayFilters?: M extends { arrayFilters: infer AF }
    ? ArrayFiltersEntriesCheck<S, M['update'], AF>
    : never
  filter: FilterCheck<S, M['filter']>
  update: UpdateCheck<S, M['update'], M['filter'], M & BulkOptions, N>
}

/**
 * One `bulkWrite` operation: filters and updates are checked, and inserts and replacements take the
 * input.
 */
type BulkWriteOperationCheck<
  S extends ModelSchema,
  O,
  N extends TimestampNames,
  BulkOptions
> = O extends { insertOne: unknown }
  ? { insertOne: { document: Input<S> } }
  : O extends { replaceOne: { filter: infer F } }
    ? {
        replaceOne: Omit<ReplaceOneModel<Output<S>>, 'filter' | 'replacement'> & {
          filter: FilterCheck<S, F>
          replacement: Input<S>
        }
      }
    : O extends { updateOne: infer M extends { filter: unknown; update: unknown } }
      ? { updateOne: BulkUpdateCheck<S, UpdateOneModel<Output<S>>, M, N, BulkOptions> }
      : O extends { updateMany: infer M extends { filter: unknown; update: unknown } }
        ? { updateMany: BulkUpdateCheck<S, UpdateManyModel<Output<S>>, M, N, BulkOptions> }
        : O extends { deleteOne: { filter: infer F } }
          ? { deleteOne: Omit<DeleteOneModel<Output<S>>, 'filter'> & { filter: FilterCheck<S, F> } }
          : O extends { deleteMany: { filter: infer F } }
            ? {
                deleteMany: Omit<DeleteManyModel<Output<S>>, 'filter'> & {
                  filter: FilterCheck<S, F>
                }
              }
            : 'an operation is insertOne, replaceOne, updateOne, updateMany, deleteOne or deleteMany'

/** Checks the operations of a `bulkWrite` one by one, given the options of the call. */
export type BulkWriteCheck<
  S extends ModelSchema,
  Operations,
  N extends TimestampNames = NoTimestamps,
  BulkOptions = unknown
> = {
  [I in keyof Operations]: BulkWriteOperationCheck<S, Operations[I], N, BulkOptions>
}

/**
 * A model: the driver's operations on one collection, with the schema validating what is written
 * and typing what is read. Filters, sorts and the `$match` stages of a pipeline are checked key by
 * key against the schema.
 */
export interface Model<S extends ModelSchema, N extends TimestampNames = NoTimestamps> {
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
  bulkWrite<
    const Operations extends ReadonlyArray<Document> &
      BulkWriteCheck<S, Operations, N, BulkOptions>,
    const BulkOptions extends BulkWriteOptions & TimestampsOperationOption<N> = BulkWriteOptions
  >(
    operations: Operations,
    options?: BulkOptions
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
   * with `for await` and chained like the driver's. A projection adjusts the type of the documents.
   */
  find<
    const F extends FilterCheck<S, F>,
    const Sort extends SortCheck<S, Sort>,
    const P extends ProjectionCheck<S, P>
  >(
    filter?: F & SuggestedFilter<S>,
    options?: ReadOptions<S, FindOptions, Sort, P> & Abortable
  ): ModelFindCursor<Projected<WithId<Output<S>>, P>, S>

  /** Finds the first document that matches the filter. */
  findOne<
    const F extends FilterCheck<S, F>,
    const Sort extends SortCheck<S, Sort>,
    const P extends ProjectionCheck<S, P>
  >(
    filter?: F & SuggestedFilter<S>,
    options?: ReadOptions<S, Omit<FindOneOptions, 'timeoutMode'>, Sort, P> & Abortable
  ): Promise<Projected<WithId<Output<S>>, P> | null>

  /** Deletes the first document that matches the filter and returns it. */
  findOneAndDelete<
    const F extends FilterCheck<S, F>,
    const Sort extends SortCheck<S, Sort>,
    const P extends ProjectionCheck<S, P>
  >(
    filter: F & SuggestedFilter<S>,
    options: ReadOptions<S, FindOneAndDeleteOptions, Sort, P> & { includeResultMetadata: true }
  ): Promise<ModifyResultOf<S, P>>
  findOneAndDelete<
    const F extends FilterCheck<S, F>,
    const Sort extends SortCheck<S, Sort>,
    const P extends ProjectionCheck<S, P>
  >(
    filter: F & SuggestedFilter<S>,
    options?: ReadOptions<S, FindOneAndDeleteOptions, Sort, P>
  ): Promise<Projected<WithId<Output<S>>, P> | null>

  /** Replaces the first document that matches the filter, validated like `replaceOne`. */
  findOneAndReplace<
    const F extends FilterCheck<S, F>,
    const Sort extends SortCheck<S, Sort>,
    const P extends ProjectionCheck<S, P>
  >(
    filter: F & SuggestedFilter<S>,
    replacement: Input<S>,
    options: ReadOptions<S, FindOneAndReplaceOptions, Sort, P> &
      TimestampsOperationOption<N> & { includeResultMetadata: true }
  ): Promise<ModifyResultOf<S, P>>
  findOneAndReplace<
    const F extends FilterCheck<S, F>,
    const Sort extends SortCheck<S, Sort>,
    const P extends ProjectionCheck<S, P>
  >(
    filter: F & SuggestedFilter<S>,
    replacement: Input<S>,
    options?: ReadOptions<S, FindOneAndReplaceOptions, Sort, P> & TimestampsOperationOption<N>
  ): Promise<Projected<WithId<Output<S>>, P> | null>

  /** Updates the first document that matches the filter and returns it. */
  findOneAndUpdate<
    const F extends FilterCheck<S, F>,
    const U extends UpdateCheck<S, U, F, O, N>,
    const O extends UpdateOptionsBase<FindOneAndUpdateOptions> &
      TimestampsOperationOption<N> &
      UpdateOptionsCheck<S, U, O>
  >(
    filter: F & SuggestedFilter<S>,
    update: U & SuggestedUpdate<S>,
    options: O & ReadSuggestions<S> & { includeResultMetadata: true }
  ): Promise<ModifyResultOf<S, ProjectionOf<O>>>
  findOneAndUpdate<
    const F extends FilterCheck<S, F>,
    const U extends UpdateCheck<S, U, F, O, N>,
    const O extends UpdateOptionsBase<FindOneAndUpdateOptions> &
      TimestampsOperationOption<N> &
      UpdateOptionsCheck<S, U, O>
  >(
    filter: F & SuggestedFilter<S>,
    update: U & SuggestedUpdate<S>,
    options?: O & ReadSuggestions<S>
  ): Promise<Projected<WithId<Output<S>>, ProjectionOf<O>> | null>

  /**
   * Validates the documents with the schema and inserts them. Returns the driver's result plus the
   * stored `documents`, with their defaults and transforms applied.
   */
  insertMany(
    documents: ReadonlyArray<Input<S>>,
    options?: BulkWriteOptions & TimestampsOperationOption<N>
  ): Promise<InsertManyResult<Output<S>> & { documents: Array<WithId<Output<S>>> }>

  /**
   * Validates the document with the schema and inserts it. Returns the driver's result plus the
   * stored `document`, with its defaults and transforms applied.
   */
  insertOne(
    document: Input<S>,
    options?: InsertOneOptions & TimestampsOperationOption<N>
  ): Promise<InsertOneResult<Output<S>> & { document: WithId<Output<S>> }>

  /**
   * Replaces the first document that matches the filter. The replacement is validated like an
   * insert, and its `_id` is written only when given: the one a `.default()` generates is dropped,
   * because the `_id` of a document cannot change.
   */
  replaceOne<const F extends FilterCheck<S, F>, const Sort extends SortCheck<S, Sort>>(
    filter: F & SuggestedFilter<S>,
    replacement: Input<S>,
    options?: Sorted<S, ReplaceOptions, Sort> & TimestampsOperationOption<N>
  ): Promise<UpdateResult<Output<S>>>

  /** Updates every document that matches the filter. */
  updateMany<
    const F extends FilterCheck<S, F>,
    const U extends UpdateCheck<S, U, F, O, N>,
    const O extends UpdateOptionsBase<UpdateOptions> &
      TimestampsOperationOption<N> &
      UpdateOptionsCheck<S, U, O>
  >(
    filter: F & SuggestedFilter<S>,
    update: U & SuggestedUpdate<S>,
    options?: O
  ): Promise<UpdateResult<Output<S>>>

  /** Updates the first document that matches the filter. */
  updateOne<
    const F extends FilterCheck<S, F>,
    const U extends UpdateCheck<S, U, F, O, N>,
    const O extends UpdateOptionsBase<UpdateOptions> &
      TimestampsOperationOption<N> &
      UpdateOptionsCheck<S, U, O>
  >(
    filter: F & SuggestedFilter<S>,
    update: U & SuggestedUpdate<S>,
    options?: O
  ): Promise<UpdateResult<Output<S>>>
}
