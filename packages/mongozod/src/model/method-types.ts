import type {
  BulkWriteOf,
  DistinctKeyOf,
  FilterOf,
  FindOptionsOf,
  InsertOf,
  PipelineOf,
  UpdateOf,
  UpdateOptionsOf
} from './model'
import type { AggregateOptions, BulkWriteOptions, DistinctOptions, ReplaceOptions } from 'mongodb'

/**
 * The type of a method of a service that takes a filter, such as one that lists, counts or deletes,
 * and its options `O`: the options of a `find` by default. Given with `satisfies`, it gives an
 * arrow function the type parameters that check the filter, which the method passes to the model;
 * the result is the method's own. A method with another shape writes its type parameters by hand.
 *
 * @example
 *   export const notesService = {
 *     list: (filter, options = {}) => NotesModel.find(filter, options),
 *     count: (filter) => NotesModel.countDocuments(filter)
 *   } satisfies {
 *     list: FilterMethod<typeof NotesModel>
 *     count: FilterMethod<typeof NotesModel, CountDocumentsOptions>
 *   }
 *
 * @see https://mongozod.dev/docs/api/mongozod#filtermethod
 */
export type FilterMethod<M, O = FindOptionsOf<M>> = <const F extends FilterOf<M, F>>(
  filter: F,
  options?: O
) => unknown

/**
 * The type of a method of a service that takes a filter, an update and the options of the update,
 * given with `satisfies`, as `FilterMethod`.
 *
 * @example
 *   export const notesService = {
 *     updateOne: (filter, update, options) =>
 *       NotesModel.findOneAndUpdate(
 *         filter,
 *         update,
 *         Object.assign({ returnDocument: 'after' as const }, options)
 *       )
 *   } satisfies { updateOne: UpdateMethod<typeof NotesModel> }
 *
 * @see https://mongozod.dev/docs/api/mongozod#updatemethod
 */
export type UpdateMethod<M> = <
  const F extends FilterOf<M, F>,
  const U extends UpdateOf<M, U, F, O>,
  const O extends UpdateOptionsOf<M, U, O>
>(
  filter: F,
  update: U,
  options?: O
) => unknown

/**
 * The type of a method of a service that takes a filter and a document that replaces the one it
 * matches, given with `satisfies`, as `FilterMethod`.
 *
 * @see https://mongozod.dev/docs/api/mongozod#replacemethod
 */
export type ReplaceMethod<M, O = ReplaceOptions> = <const F extends FilterOf<M, F>>(
  filter: F,
  replacement: InsertOf<M>,
  options?: O
) => unknown

/**
 * The type of a method of a service that takes the operations of a `bulkWrite`, given with
 * `satisfies`, as `FilterMethod`.
 *
 * @see https://mongozod.dev/docs/api/mongozod#bulkwritemethod
 */
export type BulkWriteMethod<M> = <const Ops extends BulkWriteOf<M, Ops>>(
  operations: Ops,
  options?: BulkWriteOptions
) => unknown

/**
 * The type of a method of a service that takes an aggregation pipeline, given with `satisfies`, as
 * `FilterMethod`: the `$match` stages at its start are checked like a filter.
 *
 * @see https://mongozod.dev/docs/api/mongozod#aggregatemethod
 */
export type AggregateMethod<M> = <const P extends PipelineOf<M, P>>(
  pipeline: P,
  options?: AggregateOptions
) => unknown

/**
 * The type of a method of a service that takes a path and a filter for a `distinct`, given with
 * `satisfies`, as `FilterMethod`.
 *
 * @see https://mongozod.dev/docs/api/mongozod#distinctmethod
 */
export type DistinctMethod<M> = <const K extends string, const F extends FilterOf<M, F>>(
  key: K & DistinctKeyOf<M, K>,
  filter?: F,
  options?: DistinctOptions
) => unknown
