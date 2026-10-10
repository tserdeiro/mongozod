import type { FilterCheck } from './filter'
import type { Document } from 'mongodb'

/** The stages that keep the documents of the collection as they are. */
type KeepsDocuments = { $limit: unknown } | { $skip: unknown } | { $sort: unknown }

/**
 * Checks each `$match` of a pipeline with the filter of the model, up to the first stage that
 * changes the shape of the documents. A pipeline that is not a tuple, such as a `Document[]` built
 * elsewhere, is not checked.
 */
export type PipelineCheck<S, P> = [P] extends [readonly [infer Stage, ...infer Rest]]
  ? Stage extends { $match: infer F }
    ? readonly [{ $match: FilterCheck<S, F> }, ...PipelineCheck<S, Rest>]
    : Stage extends KeepsDocuments
      ? readonly [Stage, ...PipelineCheck<S, Rest>]
      : readonly Document[]
  : readonly Document[]
