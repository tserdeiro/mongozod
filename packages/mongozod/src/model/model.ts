import type { AnyPlugin, OptionsArg } from '../plugins/plugin'
import type {
  PopulateCheck,
  PopulatedProjection,
  Populated,
  PopulateOption,
  SuggestedPopulate
} from '../references/references'
import type { Read } from '../references/virtuals'
import type { FieldAt, NotAPath } from '../schema/schema-at'
import type { FilterCheck, ModelFilter, SuggestedFilter } from '../types/filter'
import type { PathSuggestions } from '../types/path-suggestions'
import type { PipelineCheck } from '../types/pipeline'
import type { ProjectionCheck, SuggestedProjection } from '../types/projection'
import type { SortCheck, SuggestedSort } from '../types/sort'
import type {
  ArrayFiltersEntriesCheck,
  ModelUpdate,
  SuggestedUpdate,
  UpdateCheck,
  UpdateOptionsCheck
} from '../types/update'
import type { ModelCursor } from './model-cursor'
import type { ModelFindCursor } from './model-find-cursor'
import type {
  NoTimestamps,
  TimestampedInput,
  TimestampNames,
  TimestampsOperationOption
} from './timestamps'
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
  IndexDescriptionInfo,
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

/** A discriminated union of the types of document, or of other such unions. */
type DocumentUnion<O extends core.$ZodType> = core.$ZodDiscriminatedUnion<readonly O[]>

/**
 * The schema of a model: a `z.object`, or a `z.discriminatedUnion` of objects for a collection that
 * stores several types of document. Its options can be discriminated unions too, for types with
 * subtypes, up to three levels: a recursive type is too deep for TypeScript. Zod Classic and Zod
 * Mini schemas are both accepted.
 */
export type ModelSchema =
  | core.$ZodObject
  | DocumentUnion<core.$ZodObject | DocumentUnion<core.$ZodObject | DocumentUnion<core.$ZodObject>>>

/** The virtuals, references or `populate` of a model or a read that has none. */
// oxlint-disable-next-line typescript/no-generated-empty-object-type -- an object without keys is the point
export type None = Record<never, never>

/** A document as stored: the output of the schema. */
export type Output<S extends ModelSchema> = Extract<core.output<S>, Document>

/** A document to write: the input of the schema. */
export type Input<S extends ModelSchema> = core.input<S>

/** Driver options whose `sort` is checked against the schema, with the keys the editor suggests. */
type Sorted<S, O, Sort> = Omit<O, 'sort'> & { sort?: (Sort & SuggestedSort<S>) | undefined }

/**
 * Driver options whose `sort` and `projection` are checked against the schema, plus `populate` on
 * the models that have references.
 */
type ReadOptions<S, O, Sort, P, V, R, Pop> = Omit<O, 'projection' | 'sort'> &
  PopulateOption<R, Pop> & {
    projection?: (P & SuggestedProjection<S, V>) | undefined
    sort?: (Sort & SuggestedSort<S>) | undefined
  }

/**
 * The keys the editor suggests in the `sort`, `projection` and `populate` of options checked
 * elsewhere.
 */
interface ReadSuggestions<S, V, R> {
  // oxlint-disable-next-line typescript/no-generated-empty-object-type -- empty only without references
  populate?: SuggestedPopulate<R>
  projection?: SuggestedProjection<S, V>
  sort?: SuggestedSort<S>
}

type ProjectionOf<O> = O extends { projection: infer P } ? P : unknown

type PopulateOf<O> = O extends { populate: infer Pop } ? Pop : None

/**
 * The document a read returns: projected, with the virtuals it asks for or keeps and the references
 * of its `populate` replaced.
 */
export type ReadDocument<S extends ModelSchema, V, R, P, Pop> = Populated<
  Read<WithId<Output<S>>, V, PopulatedProjection<P, Pop, R>>,
  R,
  Pop
>

/** The driver's `ModifyResult`, with the document as the read returns it. */
type ModifyResultOf<S extends ModelSchema, V, R, P, Pop> = Omit<
  ModifyResult<Output<S>>,
  'value'
> & {
  value: ReadDocument<S, V, R, P, Pop> | null
}

/**
 * Driver options of an update, whose `arrayFilters`, `sort`, `projection` and `populate`
 * `UpdateOptionsCheck` checks.
 */
type UpdateOptionsBase<O> = Omit<O, 'arrayFilters' | 'projection' | 'sort'> & {
  arrayFilters?: ReadonlyArray<Document>
  populate?: Document
  projection?: Document
  sort?: Document
  /** Takes an update pipeline, whose values are not validated: they are expressions. */
  updatePipeline?: true
}

/**
 * A `distinct` key: a path of the document, suggested by the editor. A `string` key matches no
 * suggestion, so it does not compile.
 */
type DistinctKey<S, K extends string> =
  | PathSuggestions<S, 'filter'>
  | '_id'
  | (string extends K ? never : [FieldAt<S, K, 'filter'>] extends [never] ? NotAPath<K> : K)

/** `false` when the options of a `bulkWrite` turn the timestamps off. */
type TimestampsOff<O> = O extends { timestamps: false } ? false : undefined

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
  ? { insertOne: { document: TimestampedInput<S, N, TimestampsOff<BulkOptions>> } }
  : O extends { replaceOne: { filter: infer F } }
    ? {
        replaceOne: Omit<ReplaceOneModel<Output<S>>, 'filter' | 'replacement'> & {
          filter: FilterCheck<S, F>
          replacement: TimestampedInput<S, N, TimestampsOff<BulkOptions>>
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

type SchemaOf<M> = M extends { readonly schema: infer S extends ModelSchema } ? S : never

/** The timestamps of a model, which an update cannot write. */
type TimestampsOf<M> = M extends Model<ModelSchema, infer N> ? N : NoTimestamps

/** The documents of a model, as stored. */
export type DocOf<M> = WithId<Output<SchemaOf<M>>>

/**
 * A filter on the documents of a model, for a function that takes one and passes it to the model,
 * such as a plugin's method or a service. Each key is checked like the model's.
 *
 * @example
 *   function countNotes<const F extends FilterOf<typeof NotesModel, F>>(filter: F) {
 *     return NotesModel.countDocuments(filter)
 *   }
 */
export type FilterOf<M, F> = ModelFilter<SchemaOf<M>, F>

/** A sort on the documents of a model, for a function that takes one and passes it to the model. */
export type SortOf<M, Sort> = SortCheck<SchemaOf<M>, Sort> & SuggestedSort<SchemaOf<M>>

/**
 * An update of the documents of a model, given its filter and its options, for a function that
 * takes one and passes it to the model.
 */
export type UpdateOf<M, U, F, O = unknown> = ModelUpdate<SchemaOf<M>, U, F, O, TimestampsOf<M>>

/** The options argument of the model's reads, with the context its plugins ask for. */
export type ReadOptionsArg<M> = M extends {
  countDocuments(filter?: never, ...options: infer A): unknown
}
  ? A
  : never

/** The options argument of the model's updates, with the context its plugins ask for. */
export type UpdateOptionsArg<M> = M extends {
  updateMany(filter: never, update: never, ...options: infer A): unknown
}
  ? A
  : never

/** What `sync()` did, and the indexes it left as they are. */
export interface SyncResult {
  /** The names of the declared indexes, created now or already there. */
  indexes: string[]

  /** The indexes of the collection that the model does not declare. `sync()` never drops one. */
  extraIndexes: IndexDescriptionInfo[]
}

/**
 * A model: the driver's operations on one collection, with the schema validating what is written
 * and typing what is read. Filters, sorts and the `$match` stages of a pipeline are checked key by
 * key against the schema. The reads that return documents compute the virtuals `V` and populate the
 * references `R`.
 */
export interface Model<
  S extends ModelSchema,
  N extends TimestampNames = NoTimestamps,
  V = None,
  R = None,
  PL extends readonly AnyPlugin[] = []
> {
  /** The schema of each document. */
  readonly schema: S

  /** The virtuals of the model, which reads compute and do not store. */
  readonly virtuals: V

  /** The references of the model, which `populate` replaces with the documents. */
  readonly references: R

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
    const BulkOptions extends BulkWriteOptions &
      TimestampsOperationOption<N> & { updatePipeline?: true } = BulkWriteOptions
  >(
    operations: Operations,
    ...options: OptionsArg<PL, 'bulk', BulkOptions>
  ): Promise<BulkWriteResult>

  /** Counts the documents that match the filter. */
  countDocuments<const F extends FilterCheck<S, F>>(
    filter?: F & SuggestedFilter<S>,
    ...options: OptionsArg<PL, 'read', CountDocumentsOptions & Abortable>
  ): Promise<number>

  /** Deletes every document that matches the filter. */
  deleteMany<const F extends FilterCheck<S, F>>(
    filter?: F & SuggestedFilter<S>,
    ...options: OptionsArg<PL, 'delete', DeleteOptions>
  ): Promise<DeleteResult>

  /** Deletes the first document that matches the filter. */
  deleteOne<const F extends FilterCheck<S, F>>(
    filter?: F & SuggestedFilter<S>,
    ...options: OptionsArg<PL, 'delete', DeleteOptions>
  ): Promise<DeleteResult>

  /** The distinct values of a path among the documents that match the filter. */
  distinct<const K extends string, const F extends FilterCheck<S, F>>(
    key: K & DistinctKey<S, K>,
    filter?: F & SuggestedFilter<S>,
    ...options: OptionsArg<PL, 'read', DistinctOptions>
  ): Promise<Array<Exclude<Flatten<core.output<FieldAt<S, K, 'filter'>>>, undefined>>>

  /** Estimates the number of documents from the collection's metadata. */
  estimatedDocumentCount(options?: EstimatedDocumentCountOptions): Promise<number>

  /**
   * Finds the documents that match the filter. The cursor can be awaited for the array, iterated
   * with `for await` and chained like the driver's. A projection adjusts the type of the documents,
   * and asks for virtuals like for fields. `populate` replaces each reference with its document,
   * with one `$in` query per reference and per batch: `null` when it is missing.
   *
   * @example
   *   await TransactionsModel.find({}, { populate: { createdBy: { fullName: 1 } } })
   */
  find<
    const F extends FilterCheck<S, F>,
    const Sort extends SortCheck<S, Sort>,
    const P extends ProjectionCheck<S, P, V>,
    const Pop extends PopulateCheck<S, R, Pop, P>
  >(
    filter?: F & SuggestedFilter<S>,
    ...options: OptionsArg<PL, 'read', ReadOptions<S, FindOptions, Sort, P, V, R, Pop> & Abortable>
  ): ModelFindCursor<ReadDocument<S, V, R, P, Pop>, S, V, R, Pop>

  /** Finds the first document that matches the filter. */
  findOne<
    const F extends FilterCheck<S, F>,
    const Sort extends SortCheck<S, Sort>,
    const P extends ProjectionCheck<S, P, V>,
    const Pop extends PopulateCheck<S, R, Pop, P>
  >(
    filter?: F & SuggestedFilter<S>,
    ...options: OptionsArg<
      PL,
      'read',
      ReadOptions<S, Omit<FindOneOptions, 'timeoutMode'>, Sort, P, V, R, Pop> & Abortable
    >
  ): Promise<ReadDocument<S, V, R, P, Pop> | null>

  /** Deletes the first document that matches the filter and returns it. */
  findOneAndDelete<
    const F extends FilterCheck<S, F>,
    const Sort extends SortCheck<S, Sort>,
    const P extends ProjectionCheck<S, P, V>,
    const Pop extends PopulateCheck<S, R, Pop, P>
  >(
    filter: F & SuggestedFilter<S>,
    ...options: OptionsArg<
      PL,
      'delete',
      ReadOptions<S, FindOneAndDeleteOptions, Sort, P, V, R, Pop> & { includeResultMetadata: true },
      true
    >
  ): Promise<ModifyResultOf<S, V, R, P, Pop>>
  findOneAndDelete<
    const F extends FilterCheck<S, F>,
    const Sort extends SortCheck<S, Sort>,
    const P extends ProjectionCheck<S, P, V>,
    const Pop extends PopulateCheck<S, R, Pop, P>
  >(
    filter: F & SuggestedFilter<S>,
    ...options: OptionsArg<
      PL,
      'delete',
      ReadOptions<S, FindOneAndDeleteOptions, Sort, P, V, R, Pop>
    >
  ): Promise<ReadDocument<S, V, R, P, Pop> | null>

  /** Replaces the first document that matches the filter, validated like `replaceOne`. */
  findOneAndReplace<
    const F extends FilterCheck<S, F>,
    const Sort extends SortCheck<S, Sort>,
    const P extends ProjectionCheck<S, P, V>,
    const Pop extends PopulateCheck<S, R, Pop, P>,
    T extends false | undefined = false | undefined
  >(
    filter: F & SuggestedFilter<S>,
    replacement: TimestampedInput<S, N, T>,
    ...options: OptionsArg<
      PL,
      'update',
      ReadOptions<S, FindOneAndReplaceOptions, Sort, P, V, R, Pop> &
        TimestampsOperationOption<N, T> & { includeResultMetadata: true },
      true
    >
  ): Promise<ModifyResultOf<S, V, R, P, Pop>>
  findOneAndReplace<
    const F extends FilterCheck<S, F>,
    const Sort extends SortCheck<S, Sort>,
    const P extends ProjectionCheck<S, P, V>,
    const Pop extends PopulateCheck<S, R, Pop, P>,
    T extends false | undefined = false | undefined
  >(
    filter: F & SuggestedFilter<S>,
    replacement: TimestampedInput<S, N, T>,
    ...options: OptionsArg<
      PL,
      'update',
      ReadOptions<S, FindOneAndReplaceOptions, Sort, P, V, R, Pop> & TimestampsOperationOption<N, T>
    >
  ): Promise<ReadDocument<S, V, R, P, Pop> | null>

  /** Updates the first document that matches the filter and returns it. */
  findOneAndUpdate<
    const F extends FilterCheck<S, F>,
    const U extends UpdateCheck<S, U, F, O, N>,
    const O extends UpdateOptionsBase<FindOneAndUpdateOptions> &
      TimestampsOperationOption<N> &
      UpdateOptionsCheck<S, U, O, V, R>
  >(
    filter: F & SuggestedFilter<S>,
    update: U & SuggestedUpdate<S>,
    ...options: OptionsArg<
      PL,
      'update',
      O & ReadSuggestions<S, V, R> & { includeResultMetadata: true },
      true
    >
  ): Promise<ModifyResultOf<S, V, R, ProjectionOf<O>, PopulateOf<O>>>
  findOneAndUpdate<
    const F extends FilterCheck<S, F>,
    const U extends UpdateCheck<S, U, F, O, N>,
    const O extends UpdateOptionsBase<FindOneAndUpdateOptions> &
      TimestampsOperationOption<N> &
      UpdateOptionsCheck<S, U, O, V, R>
  >(
    filter: F & SuggestedFilter<S>,
    update: U & SuggestedUpdate<S>,
    ...options: OptionsArg<PL, 'update', O & ReadSuggestions<S, V, R>>
  ): Promise<ReadDocument<S, V, R, ProjectionOf<O>, PopulateOf<O>> | null>

  /**
   * Validates the documents with the schema and inserts them. Returns the driver's result plus the
   * stored `documents`, with their defaults and transforms applied.
   */
  insertMany<T extends false | undefined = false | undefined>(
    documents: ReadonlyArray<TimestampedInput<S, N, T>>,
    ...options: OptionsArg<PL, 'insert', BulkWriteOptions & TimestampsOperationOption<N, T>>
  ): Promise<InsertManyResult<Output<S>> & { documents: Array<WithId<Output<S>>> }>

  /**
   * Validates the document with the schema and inserts it. Returns the driver's result plus the
   * stored `document`, with its defaults and transforms applied.
   */
  insertOne<T extends false | undefined = false | undefined>(
    document: TimestampedInput<S, N, T>,
    ...options: OptionsArg<PL, 'insert', InsertOneOptions & TimestampsOperationOption<N, T>>
  ): Promise<InsertOneResult<Output<S>> & { document: WithId<Output<S>> }>

  /**
   * Replaces the first document that matches the filter. The replacement is validated like an
   * insert, and its `_id` is written only when given: the one a `.default()` generates is dropped,
   * because the `_id` of a document cannot change.
   */
  replaceOne<
    const F extends FilterCheck<S, F>,
    const Sort extends SortCheck<S, Sort>,
    T extends false | undefined = false | undefined
  >(
    filter: F & SuggestedFilter<S>,
    replacement: TimestampedInput<S, N, T>,
    ...options: OptionsArg<
      PL,
      'update',
      Sorted<S, ReplaceOptions, Sort> & TimestampsOperationOption<N, T>
    >
  ): Promise<UpdateResult<Output<S>>>

  /**
   * Prepares the collection on the server: applies the `$jsonSchema` when the model asks for it,
   * and creates the declared indexes. It never drops an index: an existing one that differs from
   * the declared fails with the driver's error, and the undeclared ones are returned in
   * `extraIndexes`. Call it when deploying, not on each operation.
   */
  sync(): Promise<SyncResult>

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
    ...options: OptionsArg<PL, 'update', O>
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
    ...options: OptionsArg<PL, 'update', O>
  ): Promise<UpdateResult<Output<S>>>
}
