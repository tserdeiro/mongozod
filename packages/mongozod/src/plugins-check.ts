import type { Model, ModelSchema, Output } from './model'
import type { AnyPlugin } from './plugin'
import type {
  BulkWriteOptions,
  CountDocumentsOptions,
  DeleteOptions,
  DistinctOptions,
  FindOneAndDeleteOptions,
  FindOneAndReplaceOptions,
  FindOneAndUpdateOptions,
  FindOptions,
  InsertOneOptions,
  ReplaceOptions,
  UpdateOptions
} from 'mongodb'
import type * as core from 'zod/v4/core'

/** The options of the driver in the operations of each group. */
interface DriverOptions {
  bulk: keyof BulkWriteOptions
  delete: keyof DeleteOptions | keyof FindOneAndDeleteOptions
  insert: keyof BulkWriteOptions | keyof InsertOneOptions
  read: keyof CountDocumentsOptions | keyof DistinctOptions | keyof FindOptions
  update:
    | keyof FindOneAndReplaceOptions
    | keyof FindOneAndUpdateOptions
    | keyof ReplaceOptions
    | keyof UpdateOptions
}

/** The options mongozod takes besides the driver's. */
type OwnOptions = 'context' | 'populate' | 'schema' | 'timestamps'

type FieldProblem<O, Id extends string, K extends string, F> = O extends unknown
  ? K extends keyof O
    ? O[K] extends core.output<F>
      ? never
      : `${Id} needs "${K}" with a compatible type`
    : `${Id} needs the field "${K}" in the schema`
  : never

/** The fields a plugin needs, in every type of document and with a compatible type. */
type FieldProblems<S extends ModelSchema, P> = P extends {
  fields?: infer F
  id: infer Id extends string
}
  ? { [K in keyof F & string]: FieldProblem<Output<S>, Id, K, F[K]> }[keyof F & string]
  : never

/** The options of a plugin, in the groups where it adds them. */
type OptionNames<P> = P extends { options?: infer O }
  ? {
      [G in keyof O & keyof DriverOptions]: O[G] extends core.$ZodObject
        ? [G, keyof O[G]['_zod']['def']['shape'] & string]
        : never
    }[keyof O & keyof DriverOptions]
  : never

type OptionProblems<P> = P extends { id: infer Id extends string }
  ? OptionNames<P> extends infer E
    ? E extends [infer G extends keyof DriverOptions, infer N extends string]
      ? N extends OwnOptions | DriverOptions[G]
        ? `${Id}: "${N}" is an option of ${N extends OwnOptions ? 'mongozod' : 'the driver'}`
        : never
      : never
    : never
  : never

type MethodNames<P> = P extends { methods?: infer M } ? keyof M & string : never

type PluginId<P> = P extends { id: infer Id extends string } ? Id : never

/** The options and methods that two plugins share, or that shadow a member of the model. */
type SharedProblems<
  PL extends readonly unknown[],
  Options = never,
  Methods = never
> = PL extends readonly [infer P, ...infer Rest]
  ?
      | (OptionNames<P> extends [string, infer N extends string]
          ? N extends Options
            ? `${PluginId<P>}: "${N}" is an option of another plugin`
            : never
          : never)
      | (MethodNames<P> & Methods extends infer N extends string
          ? `two plugins define "${N}"`
          : never)
      | (MethodNames<P> & keyof Model<ModelSchema> extends infer N extends string
          ? `${PluginId<P>}: "${N}" is a member of the model`
          : never)
      | SharedProblems<
          Rest,
          Options | (OptionNames<P> extends [string, infer N] ? N : never),
          Methods | MethodNames<P>
        >
  : never

type Problems<S extends ModelSchema, PL extends readonly AnyPlugin[]> =
  | { [I in keyof PL]: FieldProblems<S, PL[I]> | OptionProblems<PL[I]> }[number]
  | SharedProblems<PL>

/**
 * Checks the plugins of a model: each needs its fields in every type of document, with a
 * compatible type, and no option or method of a plugin shadows the driver's, mongozod's or another
 * plugin's. A problem becomes a property the options lack, so the error shows it.
 */
export type PluginsCheck<S extends ModelSchema, PL extends readonly AnyPlugin[]> = [
  Problems<S, PL>
] extends [never]
  ? unknown
  : { [P in Problems<S, PL>]: never }
