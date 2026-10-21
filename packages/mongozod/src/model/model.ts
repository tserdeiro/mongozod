import type { AnyPlugin, OptionsArg, PluginFills } from '../plugins/plugin'
import type {
  PopulateCheck,
  PopulateContextOption,
  PopulatedProjection,
  Populated,
  PopulateOption,
  PopulateProjections,
  SuggestedPopulate
} from '../references/references'
import type { Read } from '../references/virtuals'
import type { FieldAt, NotAPath } from '../schema/schema-at'
import type { FilterCheck, ModelFilter, SuggestedFilter } from '../types/filter'
import type { PathSuggestions } from '../types/path-suggestions'
import type { PipelineCheck } from '../types/pipeline'
import type { ProjectionCheck, SuggestedProjection } from '../types/projection'
import type { SortCheck, SortDirection, SuggestedSort } from '../types/sort'
import type {
  ArrayFiltersEntriesCheck,
  CheckedOptions,
  FoundSchema,
  ModelUpdate,
  SuggestedUpdate,
  UpdateCheck,
  UpdateOptionsCheck
} from '../types/update'
import type { NotAString } from '../utils/type-helpers'
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
  IndexDescription,
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
 *
 * @see https://mongozod.dev/docs/api/mongozod#modelschema
 */
export type ModelSchema =
  | core.$ZodObject
  | DocumentUnion<core.$ZodObject | DocumentUnion<core.$ZodObject | DocumentUnion<core.$ZodObject>>>

/** The virtuals, references or `populate` of a model or a read that has none. */
// oxlint-disable-next-line typescript/no-generated-empty-object-type -- an object without keys is the point
export type None = Record<never, never>

/**
 * A document as stored: the output of the schema.
 *
 * @see https://mongozod.dev/docs/api/mongozod#output
 */
export type Output<S extends ModelSchema> = Extract<core.output<S>, Document>

/**
 * A document to write: the input of the schema.
 *
 * @see https://mongozod.dev/docs/api/mongozod#input
 */
export type Input<S extends ModelSchema> = core.input<S>

/** Driver options whose `sort` is checked against the schema, with the keys the editor suggests. */
type Sorted<S, O, Sort> = Omit<O, 'sort'> & {
  sort?: (Sort & SuggestedSort<S> & NotAString<Sort, SortProblem>) | undefined
}

/** A sort in a string, as Mongoose takes it, which the driver takes as the name of a field. */
export type SortProblem = 'sort takes an object such as { createdAt: -1 }, not a string'

/**
 * Driver options whose `sort` and `projection` are checked against the schema, plus `populate` on
 * the models that have references.
 */
type ReadOptions<S, O, Sort, P, V, R, Pop> = Omit<O, 'projection' | 'sort'> &
  PopulateOption<R, Pop> & {
    projection?:
      | (P &
          SuggestedProjection<S, V> &
          NotAString<P, 'projection takes an object such as { name: 1 }, not a string'>)
      | undefined
    sort?: (Sort & SuggestedSort<S> & NotAString<Sort, SortProblem>) | undefined
  }

/**
 * The keys the editor suggests in the `sort`, `projection` and `populate` of options checked
 * elsewhere.
 */
interface ReadSuggestions<S, V, R> {
  // oxlint-disable-next-line typescript/no-generated-empty-object-type -- empty only without references
  populate?: SuggestedPopulate<R> | undefined
  projection?: SuggestedProjection<S, V> | undefined
  sort?: SuggestedSort<S> | undefined
}

/**
 * The `projection` of the options, also when the key is optional or may be `undefined`, as in the
 * output of a `mz.projection()` input.
 */
type ProjectionOf<O> = O extends { projection?: infer P }
  ? unknown extends P
    ? unknown
    : [Exclude<P, undefined>] extends [never]
      ? unknown
      : Exclude<P, undefined>
  : unknown

/**
 * The `populate` of the options, also when the key is optional or may be `undefined`, as in the
 * output of a `mz.populate()` input.
 */
type PopulateOf<O> = O extends { populate?: infer Pop }
  ? unknown extends Pop
    ? None
    : [Exclude<Pop, undefined>] extends [never]
      ? None
      : Exclude<Pop, undefined>
  : None

type FilterOfOptions<O> = O extends { filter: infer F } ? F : unknown

/**
 * The document a read returns: projected, with the virtuals it asks for or keeps and the references
 * of its `populate` replaced.
 */
export type ReadDocument<S extends ModelSchema, V, R, P, Pop> = Populated<
  Read<WithId<Output<S>>, V, PopulatedProjection<P, Pop, R>>,
  R,
  Pop,
  WithId<Output<S>>
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
 * `UpdateOptionsCheck` checks. When the options `O` pass an array of `arrayFilters`, the check
 * types each entry: intersected with another array type, the compiler would compare every method
 * of both.
 */
type UpdateOptionsBase<Driver, O> = Omit<Driver, 'arrayFilters' | 'projection' | 'sort'> & {
  arrayFilters?: O extends { arrayFilters: ReadonlyArray<unknown> }
    ? unknown
    : ReadonlyArray<Document>
  populate?: Document | undefined
  projection?: Document | undefined
  sort?: Document | undefined
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
  update: UpdateCheck<S, M['update'], M['filter'], CheckedOptions<M & BulkOptions>, N>
}

/**
 * One `bulkWrite` operation: filters and updates are checked, and inserts and replacements take the
 * input.
 */
type BulkWriteOperationCheck<
  S extends ModelSchema,
  O,
  N extends TimestampNames,
  BulkOptions,
  Filled extends PropertyKey
> = O extends { insertOne: unknown }
  ? { insertOne: { document: TimestampedInput<S, N, TimestampsOff<BulkOptions>, Filled> } }
  : O extends { replaceOne: { filter: infer F } }
    ? {
        replaceOne: Omit<ReplaceOneModel<Output<S>>, 'filter' | 'replacement'> & {
          filter: FilterCheck<S, F>
          replacement: TimestampedInput<S, N, TimestampsOff<BulkOptions>, Filled>
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
  BulkOptions = unknown,
  Filled extends PropertyKey = never
> = {
  [I in keyof Operations]: BulkWriteOperationCheck<S, Operations[I], N, BulkOptions, Filled>
}

type SchemaOf<M> = M extends { readonly schema: infer S extends ModelSchema } ? S : never

/** The timestamps of a model, which an update cannot write. */
// Read from a property: inferring the whole model fails on the ones that have plugins.
type TimestampsOf<M> = M extends {
  readonly '~timestamps'?: infer N extends TimestampNames | undefined
}
  ? Exclude<N, undefined>
  : NoTimestamps

/**
 * The documents of a model, as stored. A conditional, so that the type it gives does not carry the
 * model as the argument of this alias: inference walks into those arguments, and computing the
 * variance of a model costs about 150k instantiations.
 *
 * @see https://mongozod.dev/docs/api/mongozod#docof
 */
export type DocOf<M> = M extends { readonly schema: infer S extends ModelSchema }
  ? WithId<Output<S>>
  : never

type PluginsOf<M> = M extends {
  readonly '~plugins'?: infer PL extends readonly AnyPlugin[] | undefined
}
  ? Exclude<PL, undefined>
  : []

/**
 * A document to insert in a model, or to replace one with: the input of its schema, with the fields
 * its `timestamps` and its plugins fill optional, for a function that builds one, such as a
 * service. A conditional, like `DocOf`.
 *
 * @example
 *   function createNote(note: InsertOf<typeof NotesModel>) {
 *     return NotesModel.insertOne(note)
 *   }
 *
 * @see https://mongozod.dev/docs/api/mongozod#insertof
 */
export type InsertOf<M> = M extends { readonly schema: infer S extends ModelSchema }
  ? TimestampedInput<S, TimestampsOf<M>, undefined, PluginFills<PluginsOf<M>> & PropertyKey>
  : never

type VirtualsOf<M> = M extends { readonly virtuals: infer V } ? V : None

type ReferencesOf<M> = M extends { readonly references: infer R } ? R : None

/**
 * A document as a read of a model returns it, given the `projection` and the `populate` of its
 * options, and the `filter` that fixes the type of document of a union, for a function that takes
 * or returns one, such as a service or an API response.
 *
 * @example
 *   type Order = ReadOf<typeof OrdersModel, { populate: { customer: true } }>
 *   type Purchase = ReadOf<typeof EventsModel, { filter: { type: 'purchase' } }>
 *
 * @see https://mongozod.dev/docs/api/mongozod#readof
 */
export type ReadOf<M, O = unknown> = ReadDocument<
  FoundSchema<SchemaOf<M>, FilterOfOptions<O>>,
  VirtualsOf<M>,
  ReferencesOf<M>,
  ProjectionOf<O>,
  PopulateOf<O>
>

/**
 * A filter on the documents of a model, for a function that takes one and passes it to the model,
 * such as a plugin's method or a service. Each key is checked like the model's.
 *
 * @example
 *   function countNotes<const F extends FilterOf<typeof NotesModel, F>>(filter: F) {
 *     return NotesModel.countDocuments(filter)
 *   }
 *
 * @see https://mongozod.dev/docs/api/mongozod#filterof
 */
export type FilterOf<M, F> = ModelFilter<SchemaOf<M>, F>

/**
 * A sort on the documents of a model, for a function that takes one and passes it to the model.
 *
 * @see https://mongozod.dev/docs/api/mongozod#sortof
 */
export type SortOf<M, Sort> = SortCheck<SchemaOf<M>, Sort> & SuggestedSort<SchemaOf<M>>

/**
 * An update of the documents of a model, given its filter and its options, for a function that
 * takes one and passes it to the model.
 *
 * @see https://mongozod.dev/docs/api/mongozod#updateof
 */
export type UpdateOf<M, U, F, O = unknown> = ModelUpdate<SchemaOf<M>, U, F, O, TimestampsOf<M>>

/**
 * The operations of a `bulkWrite` of a model, for a function that takes them and passes them to the
 * model, such as a service. Each operation is checked like the model's, given the options `O` of
 * the call.
 *
 * @example
 *   function saveMessages<const Ops extends BulkWriteOf<typeof MessagesModel, Ops>>(
 *     operations: Ops
 *   ) {
 *     return MessagesModel.bulkWrite(operations)
 *   }
 *
 * @see https://mongozod.dev/docs/api/mongozod#bulkwriteof
 */
export type BulkWriteOf<M, Operations, O = BulkWriteOptions> = ReadonlyArray<Document> &
  BulkWriteCheck<SchemaOf<M>, Operations, TimestampsOf<M>, O, PluginFills<PluginsOf<M>>>

/**
 * An aggregation pipeline on a model, for a function that takes one and passes it to the model:
 * the `$match` stages at its start are checked like a filter of the model.
 *
 * @see https://mongozod.dev/docs/api/mongozod#pipelineof
 */
export type PipelineOf<M, P> = PipelineCheck<SchemaOf<M>, P>

/** A path a `distinct` of a model takes, for the method types of a service. */
export type DistinctKeyOf<M, K extends string> = DistinctKey<SchemaOf<M>, K>

/**
 * The options of a `find` or a `findOne` of a model, for a service that takes them from a router
 * and passes them to the model: the driver's, with a `sort` of the paths of the document and, on a
 * model with references, a `populate` as `mz.populate` outputs it, plus the options and the context
 * its plugins ask for. Not generic, so the read types each reference it allows as its id, the
 * projected document or `null`; a projection is left out, since one that is not a literal types
 * every field as optional.
 *
 * @example
 *   function listNotes<const F extends FilterOf<typeof NotesModel, F>>(
 *     filter: F,
 *     options: FindOptionsOf<typeof NotesModel> = {}
 *   ) {
 *     const { sort = { createdAt: -1 }, ...rest } = options
 *
 *     return NotesModel.find(filter, { ...rest, sort })
 *   }
 *
 * @see https://mongozod.dev/docs/api/mongozod#findoptionsof
 */
export type FindOptionsOf<M> = M extends { readonly schema: infer S extends ModelSchema }
  ? NonNullable<
      OptionsArg<
        PluginsOf<M>,
        'read',
        Omit<FindOptions, 'projection' | 'sort'> & {
          // The keys of `SuggestedSort` written out: through the alias, the model's inference of
          // the sort would compute the variance of the schema's classes.
          sort?: { [K in PathSuggestions<S, 'filter'> | '_id']?: SortDirection } | undefined
        } & ([keyof ReferencesOf<M>] extends [never]
            ? unknown
            : { populate?: PopulateProjections<ReferencesOf<M>> | undefined })
      >[0]
    >
  : never

/**
 * The options of an update that a function passes to the model with its update, such as a service:
 * their `arrayFilters` are checked against the identifiers of the update `U`, and their `sort`,
 * `projection` and `populate` against the schema, as the model does. They cannot ask for
 * `includeResultMetadata`, so a `findOneAndUpdate` that takes them returns the document.
 *
 * @example
 *   function updatePlugin<
 *     const F extends FilterOf<typeof PluginsModel, F>,
 *     const U extends UpdateOf<typeof PluginsModel, U, F, O>,
 *     const O extends UpdateOptionsOf<typeof PluginsModel, U, O>
 *   >(filter: F, update: U, options?: O) {
 *     return PluginsModel.updateOne(filter, update, options)
 *   }
 *
 * @see https://mongozod.dev/docs/api/mongozod#updateoptionsof
 */
export type UpdateOptionsOf<M, U, O> = UpdateOptionsCheck<
  SchemaOf<M>,
  U,
  O,
  VirtualsOf<M>,
  ReferencesOf<M>
> & { includeResultMetadata?: false }

/**
 * The options argument of the model's reads, with the context its plugins ask for.
 *
 * @see https://mongozod.dev/docs/api/mongozod#readoptionsarg
 */
export type ReadOptionsArg<M> = M extends {
  countDocuments(filter?: never, ...options: infer A): unknown
}
  ? A
  : never

/**
 * The options argument of the model's updates, with the context its plugins ask for.
 *
 * @see https://mongozod.dev/docs/api/mongozod#updateoptionsarg
 */
export type UpdateOptionsArg<M> = M extends {
  updateMany(filter: never, update: never, ...options: infer A): unknown
}
  ? A
  : never

/**
 * What `sync()` did, and the indexes it left as they are.
 *
 * @see https://mongozod.dev/docs/api/mongozod#syncresult
 */
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
 *
 * @see https://mongozod.dev/docs/api/mongozod#model
 */
export interface Model<
  S extends ModelSchema,
  N extends TimestampNames = NoTimestamps,
  V = None,
  R = None,
  PL extends readonly AnyPlugin[] = []
> {
  /** The schema of each document. */
  readonly 'schema': S

  /**
   * The fields that `timestamps` sets, for the types of the helpers such as `UpdateOf`: it only
   * exists in the types, so it is optional.
   */
  readonly '~timestamps'?: N

  /**
   * The plugins of the model, for the types of a `populate` that reads it, which passes on the
   * context they ask for: it only exists in the types, so it is optional.
   */
  readonly '~plugins'?: PL

  /** The virtuals of the model, which reads compute and do not store. */
  readonly 'virtuals': V

  /** The references of the model, which `populate` replaces with the documents. */
  readonly 'references': R

  /** The name of the collection. */
  readonly 'name': string

  /** The indexes the model declares, which `sync()` and the `autoIndex` plugin create. */
  readonly 'indexes': readonly IndexDescription[]

  /** The driver's database: the one `db` returns now, when it is a function. */
  readonly 'db': Db

  /**
   * The driver's collection, for what the model does not wrap, such as `watch`: the one of the
   * database `db` returns now, when it is a function.
   */
  readonly 'collection': Collection<Output<S>>

  /**
   * Runs an aggregation pipeline. With `schema`, each document is validated with it and typed by
   * it; without it, documents are returned as the driver returns them. The `$match` stages before
   * the first stage that reshapes the documents are checked like a filter.
   *
   * The group hooks of the plugins do not run on it, and it takes no `context`: a plugin that
   * isolates a tenant or hides deleted documents does not apply, so the pipeline filters them.
   */
  'aggregate'<const P extends PipelineCheck<S, P>, R extends core.$ZodType>(
    pipeline: P,
    options: AggregateOptions & Abortable & { schema: R }
  ): ModelCursor<core.output<R>>
  'aggregate'<const P extends PipelineCheck<S, P> = []>(
    pipeline?: P,
    options?: AggregateOptions & Abortable
  ): ModelCursor<Document>

  /**
   * Runs several writes in one command. Inserts and replacements are validated like `insertOne`,
   * every operation before writing: with `ordered: false` too, one that Zod rejects rejects the
   * whole batch, and only the server's errors let the others through.
   */
  'bulkWrite'<
    const Operations extends ReadonlyArray<Document> &
      BulkWriteCheck<S, Operations, N, BulkOptions, PluginFills<PL>>,
    const BulkOptions extends BulkWriteOptions &
      TimestampsOperationOption<N> & { updatePipeline?: true } = BulkWriteOptions
  >(
    operations: Operations,
    ...options: OptionsArg<PL, 'bulk', BulkOptions>
  ): Promise<BulkWriteResult>

  /** Counts the documents that match the filter. */
  'countDocuments'<const F extends FilterCheck<S, F>>(
    filter?: F & SuggestedFilter<S>,
    ...options: OptionsArg<PL, 'read', CountDocumentsOptions & Abortable>
  ): Promise<number>

  /** Deletes every document that matches the filter. */
  'deleteMany'<const F extends FilterCheck<S, F>>(
    filter?: F & SuggestedFilter<S>,
    ...options: OptionsArg<PL, 'delete', DeleteOptions>
  ): Promise<DeleteResult>

  /** Deletes the first document that matches the filter. */
  'deleteOne'<const F extends FilterCheck<S, F>>(
    filter?: F & SuggestedFilter<S>,
    ...options: OptionsArg<PL, 'delete', DeleteOptions>
  ): Promise<DeleteResult>

  /** The distinct values of a path among the documents that match the filter. */
  'distinct'<const K extends string, const F extends FilterCheck<S, F>>(
    key: K & DistinctKey<S, K>,
    filter?: F & SuggestedFilter<S>,
    ...options: OptionsArg<PL, 'read', DistinctOptions>
  ): Promise<Array<Exclude<Flatten<core.output<FieldAt<S, K, 'filter'>>>, undefined>>>

  /** Estimates the number of documents from the collection's metadata. */
  'estimatedDocumentCount'(options?: EstimatedDocumentCountOptions): Promise<number>

  /**
   * Finds the documents that match the filter. The cursor can be awaited for the array, iterated
   * with `for await` and chained like the driver's. A projection adjusts the type of the documents,
   * and asks for virtuals like for fields. `populate` replaces each reference with its document,
   * with one `$in` query per reference and per batch: `null` when it is missing. The filter is
   * checked by its types, as the driver's, without casting, and at runtime only an `undefined`
   * value is rejected, which the driver would send as `null`: one that arrives without types, such
   * as a client's, goes through `mz.filter` first. `ReadOf` types what it returns, with the same
   * `projection` and `populate`, for a service or a response.
   *
   * @example
   *   await TransactionsModel.find({}, { populate: { createdBy: { projection: { fullName: 1 } } } })
   */
  'find'<
    const F extends FilterCheck<S, F>,
    const Sort extends SortCheck<S, Sort>,
    const P extends ProjectionCheck<S, P, V>,
    const Pop extends PopulateCheck<S, R, Pop, P>
  >(
    filter?: F & SuggestedFilter<S>,
    ...options: OptionsArg<PL, 'read', ReadOptions<S, FindOptions, Sort, P, V, R, Pop> & Abortable>
  ): ModelFindCursor<ReadDocument<FoundSchema<S, F>, V, R, P, Pop>, S, V, R, Pop, FoundSchema<S, F>>

  /**
   * Finds the first document that matches the filter. `ReadOf` types what it returns, as for
   * `find`.
   */
  'findOne'<
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
  ): Promise<ReadDocument<FoundSchema<S, F>, V, R, P, Pop> | null>

  /** Deletes the first document that matches the filter and returns it. */
  'findOneAndDelete'<
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
  'findOneAndDelete'<
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

  /**
   * Replaces the first document that matches the filter, validated like `replaceOne`. With
   * `timestamps`, `createdAt` and `updatedAt` are now unless the replacement gives them, as in
   * Mongoose: pass the `createdAt` of the document to keep it.
   */
  'findOneAndReplace'<
    const F extends FilterCheck<S, F>,
    const Sort extends SortCheck<S, Sort>,
    const P extends ProjectionCheck<S, P, V>,
    const Pop extends PopulateCheck<S, R, Pop, P>,
    T extends false | undefined = false | undefined
  >(
    filter: F & SuggestedFilter<S>,
    replacement: TimestampedInput<S, N, T, PluginFills<PL>>,
    ...options: OptionsArg<
      PL,
      'update',
      ReadOptions<S, FindOneAndReplaceOptions, Sort, P, V, R, Pop> &
        TimestampsOperationOption<N, T> & { includeResultMetadata: true },
      true
    >
  ): Promise<ModifyResultOf<S, V, R, P, Pop>>
  'findOneAndReplace'<
    const F extends FilterCheck<S, F>,
    const Sort extends SortCheck<S, Sort>,
    const P extends ProjectionCheck<S, P, V>,
    const Pop extends PopulateCheck<S, R, Pop, P>,
    T extends false | undefined = false | undefined
  >(
    filter: F & SuggestedFilter<S>,
    replacement: TimestampedInput<S, N, T, PluginFills<PL>>,
    ...options: OptionsArg<
      PL,
      'update',
      ReadOptions<S, FindOneAndReplaceOptions, Sort, P, V, R, Pop> & TimestampsOperationOption<N, T>
    >
  ): Promise<ReadDocument<S, V, R, P, Pop> | null>

  /**
   * Updates the first document that matches the filter and returns it. Validated like
   * `updateOne`.
   */
  'findOneAndUpdate'<
    const F extends FilterCheck<S, F>,
    const U extends UpdateCheck<S, U, F, CheckedOptions<O>, N>,
    const O extends UpdateOptionsBase<FindOneAndUpdateOptions, O> &
      TimestampsOperationOption<N> &
      UpdateOptionsCheck<S, U, O, V, R>
  >(
    filter: F & SuggestedFilter<S>,
    update: U & SuggestedUpdate<S>,
    ...options: OptionsArg<
      PL,
      'update',
      O &
        ReadSuggestions<S, V, R> &
        PopulateContextOption<R, PopulateOf<O>> & { includeResultMetadata: true },
      true
    >
  ): Promise<ModifyResultOf<S, V, R, ProjectionOf<O>, PopulateOf<O>>>
  'findOneAndUpdate'<
    const F extends FilterCheck<S, F>,
    const U extends UpdateCheck<S, U, F, CheckedOptions<O>, N>,
    const O extends UpdateOptionsBase<FindOneAndUpdateOptions, O> &
      TimestampsOperationOption<N> &
      UpdateOptionsCheck<S, U, O, V, R>
  >(
    filter: F & SuggestedFilter<S>,
    update: U & SuggestedUpdate<S>,
    ...options: OptionsArg<
      PL,
      'update',
      O & ReadSuggestions<S, V, R> & PopulateContextOption<R, PopulateOf<O>>
    >
  ): Promise<ReadDocument<S, V, R, ProjectionOf<O>, PopulateOf<O>> | null>

  /**
   * Validates the documents with the schema and inserts them. Returns the driver's result plus the
   * stored `documents`, with their defaults and transforms applied. Every document is validated
   * before writing: with `ordered: false` too, one that Zod rejects rejects the whole batch, and
   * only the server's errors, such as a duplicate key, let the others through.
   */
  'insertMany'<T extends false | undefined = false | undefined>(
    documents: ReadonlyArray<TimestampedInput<S, N, T, PluginFills<PL>>>,
    ...options: OptionsArg<PL, 'insert', BulkWriteOptions & TimestampsOperationOption<N, T>>
  ): Promise<InsertManyResult<Output<S>> & { documents: Array<WithId<Output<S>>> }>

  /**
   * Validates the document with the schema and inserts it. Returns the driver's result plus the
   * stored `document`, with its defaults and transforms applied.
   */
  'insertOne'<T extends false | undefined = false | undefined>(
    document: TimestampedInput<S, N, T, PluginFills<PL>>,
    ...options: OptionsArg<PL, 'insert', InsertOneOptions & TimestampsOperationOption<N, T>>
  ): Promise<InsertOneResult<Output<S>> & { document: WithId<Output<S>> }>

  /**
   * Replaces the first document that matches the filter. The replacement is validated like an
   * insert, and its `_id` is written only when given: the one a `.default()` generates is dropped,
   * because the `_id` of a document cannot change. With `timestamps`, `createdAt` and `updatedAt`
   * are now unless the replacement gives them, as in Mongoose: pass the `createdAt` of the document
   * to keep it.
   */
  'replaceOne'<
    const F extends FilterCheck<S, F>,
    const Sort extends SortCheck<S, Sort>,
    T extends false | undefined = false | undefined
  >(
    filter: F & SuggestedFilter<S>,
    replacement: TimestampedInput<S, N, T, PluginFills<PL>>,
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
  'sync'(): Promise<SyncResult>

  /**
   * Updates every document that matches the filter. Each value is validated with the schema of its
   * path. The refinements of the whole document, such as one that compares two fields, do not run
   * on updates, as in Mongoose, but on inserts, replacements and the document an upsert would
   * insert: to check them, read the document and `replaceOne` it.
   */
  'updateMany'<
    const F extends FilterCheck<S, F>,
    const U extends UpdateCheck<S, U, F, CheckedOptions<O>, N>,
    const O extends UpdateOptionsBase<UpdateOptions, O> &
      TimestampsOperationOption<N> &
      UpdateOptionsCheck<S, U, O>
  >(
    filter: F & SuggestedFilter<S>,
    update: U & SuggestedUpdate<S>,
    ...options: OptionsArg<PL, 'update', O>
  ): Promise<UpdateResult<Output<S>>>

  /**
   * Updates the first document that matches the filter. Each value is validated with the schema of
   * its path. The refinements of the whole document, such as one that compares two fields, do not
   * run on updates, as in Mongoose, but on inserts, replacements and the document an upsert would
   * insert: to check them, read the document and `replaceOne` it.
   */
  'updateOne'<
    const F extends FilterCheck<S, F>,
    const U extends UpdateCheck<S, U, F, CheckedOptions<O>, N>,
    const O extends UpdateOptionsBase<UpdateOptions, O> &
      TimestampsOperationOption<N> &
      UpdateOptionsCheck<S, U, O>
  >(
    filter: F & SuggestedFilter<S>,
    update: U & SuggestedUpdate<S>,
    ...options: OptionsArg<PL, 'update', O>
  ): Promise<UpdateResult<Output<S>>>
}
