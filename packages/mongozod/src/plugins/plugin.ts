import type { None } from '../model/model'
import type { ModelCursor } from '../model/model-cursor'
import type { UnionToIntersection } from '../utils/type-helpers'
import type {
  BulkWriteResult,
  ClientSession,
  Db,
  DeleteResult,
  Document,
  InsertManyResult,
  InsertOneResult,
  ModifyResult,
  UpdateResult
} from 'mongodb'
import type * as core from 'zod/v4/core'

/**
 * The groups of operations a plugin hooks into, each with the operations that share a filter, so
 * that a `before` that only changes the filter works for the whole group. `aggregate` and
 * `estimatedDocumentCount` have no filter and no group: only their own hooks and the middleware.
 */
export const GROUPS = {
  bulk: ['bulkWrite'],
  delete: ['deleteMany', 'deleteOne', 'findOneAndDelete'],
  insert: ['insertMany', 'insertOne'],
  read: ['countDocuments', 'distinct', 'find', 'findOne'],
  update: ['findOneAndReplace', 'findOneAndUpdate', 'replaceOne', 'updateMany', 'updateOne']
} as const

/** A group of operations. */
export type Group = keyof typeof GROUPS

/** The arguments of each operation, as plugins see them: documents are `Document`s. */
export interface OperationArgs {
  aggregate: { options: Document; pipeline: Document[] }
  bulkWrite: { operations: Document[]; options: Document }
  countDocuments: { filter: Document; options: Document }
  deleteMany: { filter: Document; options: Document }
  deleteOne: { filter: Document; options: Document }
  distinct: { filter: Document; key: string; options: Document }
  estimatedDocumentCount: { options: Document }
  find: { filter: Document; options: Document }
  findOne: { filter: Document; options: Document }
  findOneAndDelete: { filter: Document; options: Document }
  findOneAndReplace: { filter: Document; options: Document; replacement: Document }
  findOneAndUpdate: { filter: Document; options: Document; update: Document | Document[] }
  insertMany: { documents: Document[]; options: Document }
  insertOne: { document: Document; options: Document }
  replaceOne: { filter: Document; options: Document; replacement: Document }
  updateMany: { filter: Document; options: Document; update: Document | Document[] }
  updateOne: { filter: Document; options: Document; update: Document | Document[] }
}

/** An operation of the model that plugins see. `watch` goes to the driver's collection. */
export type Operation = keyof OperationArgs

/** The driver's `UpdateResult`, with an `_id` of any type. */
export type AnyUpdateResult = Omit<UpdateResult, 'upsertedId'> & { upsertedId: unknown }

/** The driver's `ModifyResult`, with a document of any type. */
export type AnyModifyResult = Omit<ModifyResult, 'value'> & { value: Document | null }

/** The result of `insertOne`, with an `_id` of any type. */
export type AnyInsertOneResult = Omit<InsertOneResult, 'insertedId'> & {
  document: Document
  insertedId: unknown
}

/** The result of `insertMany`, with `_id`s of any type. */
export type AnyInsertManyResult = Omit<InsertManyResult, 'insertedIds'> & {
  documents: Document[]
  insertedIds: { [index: number]: unknown }
}

/**
 * The result of each operation, as plugins see it, for any type of `_id`. `find` and `aggregate`
 * return a cursor, so their plugins see one batch of documents at a time.
 */
export interface OperationResults {
  aggregate: unknown[]
  bulkWrite: BulkWriteResult
  countDocuments: number
  deleteMany: DeleteResult
  deleteOne: DeleteResult
  distinct: unknown[]
  estimatedDocumentCount: number
  find: Document[]
  findOne: Document | null
  findOneAndDelete: AnyModifyResult | Document | null
  findOneAndReplace: AnyModifyResult | Document | null
  findOneAndUpdate: AnyModifyResult | Document | null
  insertMany: AnyInsertManyResult
  insertOne: AnyInsertOneResult
  replaceOne: AnyUpdateResult
  updateMany: AnyUpdateResult
  updateOne: AnyUpdateResult
}

type GroupOperations<G extends Group> = (typeof GROUPS)[G][number]

/** The group of an operation, or `never` for one without a group. */
type GroupOf<O extends Operation> = {
  [G in Group]: O extends GroupOperations<G> ? G : never
}[Group]

/**
 * A model as plugins see it: its operations take and return `Document`s, and go through every
 * plugin again, so a hook can dispatch another operation. Methods declare `this` with it.
 */
export interface AnyModel {
  readonly db: Db
  readonly name: string
  readonly schema: core.$ZodType
  aggregate(pipeline?: readonly Document[], options?: Document): ModelCursor<unknown>
  bulkWrite(operations: readonly Document[], options?: Document): Promise<BulkWriteResult>
  countDocuments(filter?: Document, options?: Document): Promise<number>
  deleteMany(filter?: Document, options?: Document): Promise<DeleteResult>
  deleteOne(filter?: Document, options?: Document): Promise<DeleteResult>
  distinct(key: string, filter?: Document, options?: Document): Promise<unknown[]>
  estimatedDocumentCount(options?: Document): Promise<number>
  find(filter?: Document, options?: Document): ModelCursor<Document>
  findOne(filter?: Document, options?: Document): Promise<Document | null>
  findOneAndDelete(filter: Document, options?: Document): Promise<AnyModifyResult | Document | null>
  findOneAndReplace(
    filter: Document,
    replacement: Document,
    options?: Document
  ): Promise<AnyModifyResult | Document | null>
  findOneAndUpdate(
    filter: Document,
    update: Document,
    options?: Document
  ): Promise<AnyModifyResult | Document | null>
  insertMany(documents: readonly Document[], options?: Document): Promise<AnyInsertManyResult>
  insertOne(document: Document, options?: Document): Promise<AnyInsertOneResult>
  replaceOne(filter: Document, replacement: Document, options?: Document): Promise<AnyUpdateResult>
  updateMany(filter: Document, update: Document, options?: Document): Promise<AnyUpdateResult>
  updateOne(filter: Document, update: Document, options?: Document): Promise<AnyUpdateResult>
}

/** One `z.object` per group of operations, for the options or the context of a plugin. */
export type GroupSchemas = { [G in Group]?: core.$ZodObject }

/** The context a plugin receives in an operation of a group: the output of its schema. */
type ContextOf<C, G> = G extends keyof C
  ? C[G] extends core.$ZodObject
    ? core.output<C[G]>
    : undefined
  : undefined

type HookInput<O extends Operation, C> = O extends Operation
  ? { args: OperationArgs[O]; context: ContextOf<C, GroupOf<O>>; model: AnyModel; operation: O }
  : never

/**
 * What a `before` returns. In a group hook, `args` and `result` may be those of any operation of
 * the group, so that one that only changes the filter needs no narrowing.
 */
type BeforeReturn<O extends Operation> =
  | { args: OperationArgs[O] }
  | { result: OperationResults[O] }
  | undefined
  | void

type AfterInput<O extends Operation, C> = O extends Operation
  ? HookInput<O, C> & { result: OperationResults[O] }
  : never

type AfterReturn<O extends Operation> = { result: OperationResults[O] } | undefined | void

/**
 * The hooks of one operation, or of the operations of a group. They are methods, so that the core
 * can run any of them with the arguments of its operation.
 */
export interface OperationHooks<O extends Operation, C> {
  /** Runs after the operation, with its result, and may replace it with `{ result }`. */
  after?(input: AfterInput<O, C>): AfterReturn<O> | Promise<AfterReturn<O>>

  /**
   * Runs before the operation, with its arguments as written: it may change them with `{ args }`,
   * or skip the operation with `{ result }`. An error it throws stops the operation.
   */
  before?(input: HookInput<O, C>): BeforeReturn<O> | Promise<BeforeReturn<O>>
}

/** The hooks of a plugin, by operation or by group. */
export type Hooks<C> = { [O in Operation]?: OperationHooks<O, C> } & {
  [G in Group]?: OperationHooks<GroupOperations<G>, C>
}

/** What `next()` takes in a middleware: the session of a transaction. */
export interface NextOptions {
  session?: ClientSession
}

/** What a middleware receives: the operation, and `next()` to run it. */
export type MiddlewareInput<C> = {
  [O in Operation]: HookInput<O, C> & {
    next: (options?: NextOptions) => Promise<OperationResults[O]>
  }
}[Operation]

/**
 * A plugin of a model. Built with `definePlugin`, usually from a function that takes the plugin's
 * own configuration. The types know the fields it fills when `Fills` names them in a tuple, as
 * `definePlugin` infers it: a plugin typed without one, such as the return type of a factory
 * `Plugin<'tenant', { tenantId: z.ZodString }>`, takes a plugin that fills some, and fills none.
 */
export interface Plugin<
  Id extends string = string,
  Fields extends core.$ZodShape = core.$ZodShape,
  Options extends GroupSchemas = GroupSchemas,
  Context extends GroupSchemas = GroupSchemas,
  Methods extends object = object,
  Fills extends ReadonlyArray<keyof Fields & string> = ReadonlyArray<keyof Fields & string>
> {
  /** Identifies the plugin in error messages. */
  id: Id

  /** The fields the model's schema must declare, with a compatible type. */
  fields?: Fields

  /**
   * The fields of `fields` that the plugin's `before` hooks fill on every insert and replacement,
   * which these then take as optional, as they take the fields of `timestamps`. The schema still
   * validates them after the hooks, so one the plugin does not fill throws a `ZodError`.
   */
  fills?: Fills

  /** The options the plugin adds to the operations of each group. */
  options?: Options

  /** What the plugin needs from each call, per group: the options of those operations require it. */
  context?: Context

  /** Hooks by operation or by group, which run before and after the operation. */
  hooks?: Hooks<Context>

  /** Wraps the whole operation, for a transaction or a measure of time. */
  middleware?(input: MiddlewareInput<Context>): Promise<unknown>

  /** Methods added to the model. Each declares `this` as a generic model to take its types. */
  methods?: Methods
}

/**
 * Defines a plugin, like better-auth's: an `id`, the `fields` the schema must declare, the
 * `options` and `context` it adds per group of operations, `hooks` before and after each operation
 * or group, a `middleware` that wraps the operation and `methods` for the model.
 *
 * @example
 *   export function softDelete() {
 *   return definePlugin({ id: 'softDelete', fields: { deletedAt: z.date().optional() }, hooks: { … } })
 *   }
 */
// The plugin's own definition types it: `NoInfer` keeps the context of a call, such as the
// `plugins` of a model, from inferring its generics.
export function definePlugin<
  const Id extends string,
  const Fields extends core.$ZodShape = None,
  const Options extends GroupSchemas = None,
  const Context extends GroupSchemas = None,
  const Methods extends object = None,
  const Fills extends ReadonlyArray<keyof Fields & string> = readonly []
>(
  plugin: Plugin<Id, Fields, Options, Context, Methods, Fills>
): Plugin<
  NoInfer<Id>,
  NoInfer<Fields>,
  NoInfer<Options>,
  NoInfer<Context>,
  NoInfer<Methods>,
  NoInfer<Fills>
> {
  return plugin
}

// How the plugins of a model change its types.

/**
 * Any plugin, whatever its generics. Its hooks are methods, so the hooks of every plugin fit, with
 * the arguments of any operation.
 */
export interface AnyPlugin {
  context?: GroupSchemas
  fields?: core.$ZodShape
  fills?: ReadonlyArray<string>
  hooks?: Partial<
    Record<string, { after?(input: Document): unknown; before?(input: Document): unknown }>
  >
  id: string
  methods?: object
  middleware?(input: Document): Promise<unknown>
  options?: GroupSchemas
}

type SchemaInput<C, G extends Group> = G extends keyof C
  ? C[G] extends core.$ZodObject
    ? core.input<C[G]>
    : never
  : never

type OptionsSchemas<P> = P extends { options?: infer O } ? O : never

type ContextSchemas<P> = P extends { context?: infer C } ? C : never

/** The options the plugins add to the operations of a group. */
type PluginOptions<PL extends readonly AnyPlugin[], G extends Group> = UnionToIntersection<
  { [I in keyof PL]: SchemaInput<OptionsSchemas<PL[I]>, G> }[number]
>

/** What the plugins ask for in the context of a group, one object per plugin that declares one. */
export type ContextUnion<PL extends readonly AnyPlugin[], G extends Group> = {
  [I in keyof PL]: SchemaInput<ContextSchemas<PL[I]>, G>
}[number]

/**
 * The options argument of an operation of a group: optional, with the options of the plugins, or
 * required, with `context`, when a plugin declares one for the group. `Required` makes it required
 * in any case, for the signatures that need an option such as `includeResultMetadata`.
 */
export type OptionsArg<
  PL extends readonly AnyPlugin[],
  G extends Group,
  Base,
  Required extends boolean = false
> = [ContextUnion<PL, G>] extends [never]
  ? Required extends true
    ? [options: Base & PluginOptions<PL, G>]
    : [options?: Base & PluginOptions<PL, G>]
  : [options: Base & PluginOptions<PL, G> & { context: UnionToIntersection<ContextUnion<PL, G>> }]

/**
 * The fields a plugin fills, when its type names them in a tuple, as `definePlugin` infers it: an
 * array, which the type of a plugin without its `Fills` gives, fills none that the types know of.
 */
type FillsOfPlugin<P> = P extends { fills?: infer L extends ReadonlyArray<string> }
  ? number extends L['length']
    ? never
    : L[number]
  : never

/** The fields the plugins fill on inserts and replacements, which these take as optional. */
export type PluginFills<PL extends readonly AnyPlugin[]> = {
  [I in keyof PL]: FillsOfPlugin<PL[I]>
}[number]

type MethodsOfPlugin<P> = P extends { methods?: infer M } ? M : never

/** The methods the plugins add to the model. */
export type PluginMethods<PL extends readonly AnyPlugin[]> = UnionToIntersection<
  { [I in keyof PL]: MethodsOfPlugin<PL[I]> }[number]
>
