import type { ModelSchema, None } from '../model/model'
import type { LockedFields, NoTimestamps, TimestampNames } from '../model/timestamps'
import type { SetMarker } from '../mzod/fields/set'
import type { PopulateCheck } from '../references/references'
import type {
  Def,
  ExtraKey,
  IsIdentifier,
  NotAPath,
  SchemaAt,
  TupleStep
} from '../schema/schema-at'
import type { Unwrap } from '../schema/unwrap-schema'
import type { ConditionCheck, ElementConditionCheck, ElementSchema, KeyCheck } from './filter'
import type { Loose } from './loose'
import type { PathSuggestions, Positional } from './path-suggestions'
import type { ProjectionCheck } from './projection'
import type { SortCheck } from './sort'
import type { Document } from 'mongodb'
import type * as core from 'zod/v4/core'

/**
 * The intersection of the members of a union of one-element tuples. The tuples keep each member
 * whole, where `UnionToIntersection` would also split a member that is a union, such as `boolean`.
 */
type IntersectAll<T> = (T extends [infer V] ? (value: V) => void : never) extends (
  value: infer I
) => void
  ? I
  : never

type DiscriminatorOf<S> =
  Def<S> extends { discriminator: infer D extends string; type: 'union' } ? D : never

type OptionsOf<S> =
  Def<S> extends { options: infer O extends readonly unknown[]; type: 'union' } ? O[number] : never

// Discriminated unions. The discriminator of each union in a path is fixed by the condition that
// selects its document or element: the filter, or the arrayFilters entry of its `$[id]`.

/** The values an equality, `$eq` or `$in` fixes; `never` for any other condition. */
type Fixes<V> = V extends boolean | number | string
  ? V
  : V extends { $eq: infer X }
    ? X
    : V extends { $in: ReadonlyArray<infer X> }
      ? X
      : never

/** The values a query fixes for a key, at its top level or inside `$and`. */
type ConstraintsAt<F, K extends string> =
  | (K extends keyof F ? ([Fixes<F[K]>] extends [never] ? never : [Fixes<F[K]>]) : never)
  | (F extends { $and: ReadonlyArray<infer C> }
      ? C extends unknown
        ? ConstraintsAt<C, K>
        : never
      : never)

/** Where the conditions that select the current document or element come from. */
type Scope =
  | { kind: 'filter'; prefix: string }
  | { id: string; kind: 'arrayFilter'; prefix: string }
  | { kind: 'none'; path: string; prefix: string }

type ScopeConstraints<Sc extends Scope, F, AF, D extends string> = Sc extends {
  kind: 'filter'
  prefix: infer P extends string
}
  ? ConstraintsAt<F, `${P}${D}`>
  : Sc extends { id: infer Id extends string; kind: 'arrayFilter'; prefix: infer P extends string }
    ? AF extends ReadonlyArray<infer E>
      ? E extends unknown
        ? ConstraintsAt<E, `${Id}.${P}${D}`>
        : never
      : never
    : never

/** Where to fix a union's discriminator, for the error message. */
type FixAt<Sc extends Scope, D extends string> = Sc extends {
  kind: 'filter'
  prefix: infer P extends string
}
  ? `fix "${P}${D}" in the filter`
  : Sc extends { id: infer Id extends string; kind: 'arrayFilter'; prefix: infer P extends string }
    ? `fix "${Id}.${P}${D}" in arrayFilters`
    : Sc extends { kind: 'none'; path: infer Path extends string; prefix: infer P extends string }
      ? `reach "${Path}" with $[id] and fix "id.${P}${D}" in arrayFilters`
      : never

/**
 * The options whose discriminator can take one of the values `V`: one with a `z.enum` takes
 * several, and stays when any of them is fixed, as the runtime picks it.
 */
type OptionWith<O, D extends string, V> = O extends unknown
  ? [Extract<core.output<SchemaAt<O, D, 'filter'>>, V>] extends [never]
    ? never
    : O
  : never

/** The options of a union that the scope allows: all of them when it fixes nothing. */
type Allowed<U, Sc extends Scope, F, AF> = [
  ScopeConstraints<Sc, F, AF, DiscriminatorOf<U>>
] extends [never]
  ? OptionsOf<U>
  : OptionWith<
      OptionsOf<U>,
      DiscriminatorOf<U>,
      IntersectAll<ScopeConstraints<Sc, F, AF, DiscriminatorOf<U>>>
    >

/**
 * The discriminators of a union and of the unions nested in it, up to the three levels of a
 * `ModelSchema`.
 */
type Discriminators<S, Depth extends unknown[] = []> = Depth['length'] extends 3
  ? never
  : [DiscriminatorOf<S>] extends [never]
    ? never
    : DiscriminatorOf<S> | Discriminators<OptionsOf<S>, [...Depth, 1]>

/**
 * The types of document a filter allows: at each discriminated union, the options whose
 * discriminator it fixes with an equality, `$eq` or `$in`, at its top level or inside `$and`.
 */
type AllowedTypes<S, F> = [DiscriminatorOf<S>] extends [never]
  ? S
  : // Any schema, as the one of the signature that implements a model, has no options to choose.
    string extends DiscriminatorOf<S>
    ? S
    : Allowed<S, { kind: 'filter'; prefix: '' }, F, never> extends infer A
      ? A extends unknown
        ? AllowedTypes<A, F>
        : never
      : never

/**
 * The schema of the documents a filter finds: the types of document it allows, the same ones an
 * update writes, or the whole schema when it fixes no discriminator.
 */
export type FoundSchema<S extends ModelSchema, F> = [DiscriminatorOf<S>] extends [never]
  ? S
  : [ConstraintsAt<F, Discriminators<S>>] extends [never]
    ? S
    : Extract<AllowedTypes<S, F>, ModelSchema>

type Extend<Sc extends Scope, Seg extends string> = Sc extends {
  kind: 'filter'
  prefix: infer P extends string
}
  ? { kind: 'filter'; prefix: `${P}${Seg}.` }
  : Sc extends { id: infer Id extends string; kind: 'arrayFilter'; prefix: infer P extends string }
    ? { id: Id; kind: 'arrayFilter'; prefix: `${P}${Seg}.` }
    : Sc extends { kind: 'none'; path: infer Path extends string; prefix: infer P extends string }
      ? { kind: 'none'; path: Path; prefix: `${P}${Seg}.` }
      : never

/**
 * The schema of a key its object may lack, which `$unset` can remove: a key of a record whose keys
 * are not a fixed set, such as `z.record(z.string(), …)`, or one a catchall takes.
 */
interface MayLack<V> {
  _zod: {
    def: { innerType: V; type: 'optional' }
    input: core.input<V> | undefined
    output: core.output<V> | undefined
  }
}

/** One segment of an update path: the sub-schema it leads to and the scope after it. */
type Next<S, Seg extends string, Sc extends Scope, Path extends string> =
  Def<Unwrap<S>> extends infer X
    ? X extends { type: 'any' | 'unknown' }
      ? [Unwrap<S>, Extend<Sc, Seg>]
      : X extends { shape: infer Shape; type: 'object' }
        ? Seg extends keyof Shape
          ? [Shape[Seg], Extend<Sc, Seg>]
          : [ExtraKey<Unwrap<S>>] extends [never]
            ? never
            : [MayLack<ExtraKey<Unwrap<S>>>, Extend<Sc, Seg>]
        : X extends { type: 'record'; valueType: infer V }
          ? // Zod types the record of a fixed set of keys with all of them, unless it is partial.
            [None extends core.output<Unwrap<S>> ? MayLack<V> : V, Extend<Sc, Seg>]
          : X extends { element: infer E; type: 'array' }
            ? Seg extends `$[${infer Id}]`
              ? Id extends ''
                ? [E, { kind: 'none'; path: Path; prefix: '' }]
                : IsIdentifier<Id> extends true
                  ? [E, { id: Id; kind: 'arrayFilter'; prefix: '' }]
                  : never
              : Seg extends '$' | `${number}`
                ? [E, { kind: 'none'; path: Path; prefix: '' }]
                : never
            : X extends { options: infer O extends readonly unknown[]; type: 'union' }
              ? O[number] extends infer Option
                ? Option extends unknown
                  ? Next<Option, Seg, Sc, Path>
                  : never
                : never
              : X extends { items: infer Items; rest: infer Rest; type: 'tuple' }
                ? [TupleStep<Items, Rest, Seg>] extends [never]
                  ? never
                  : [TupleStep<Items, Rest, Seg>, { kind: 'none'; path: Path; prefix: '' }]
                : never
    : never

type Missing<Why extends string> = ['missing', Why]

/** Walks a path: at each discriminated union, only into the options its scope allows. */
type Walk<S, P extends string, Sc extends Scope, F, AF, Path extends string> = [
  DiscriminatorOf<Unwrap<S>>
] extends [never]
  ? WalkStep<S, P, Sc, F, AF, Path>
  : P extends DiscriminatorOf<Unwrap<S>> | `${DiscriminatorOf<Unwrap<S>>}.${string}`
    ? ['discriminator']
    : [Allowed<Unwrap<S>, Sc, F, AF>] extends [never]
      ? Missing<'no type matches the filter'>
      : Allowed<Unwrap<S>, Sc, F, AF> extends infer A
        ? A extends unknown
          ? // An option can be a discriminated union too, whose own discriminator the scope fixes.
            Walk<A, P, Sc, F, AF, Path> extends infer R
            ? R extends ['missing', 'not a path']
              ? Missing<FixAt<Sc, DiscriminatorOf<Unwrap<S>>>>
              : R
            : never
          : never
        : never

type WalkStep<
  S,
  P extends string,
  Sc extends Scope,
  F,
  AF,
  Path extends string
> = P extends `${infer Seg}.${infer Rest}`
  ? [Next<S, Seg, Sc, Path>] extends [never]
    ? Missing<'not a path'>
    : Next<S, Seg, Sc, Path> extends [infer Sub, infer NextScope extends Scope]
      ? Walk<Sub, Rest, NextScope, F, AF, Path extends '' ? Seg : `${Path}.${Seg}`>
      : never
  : [Next<S, P, Sc, Path>] extends [never]
    ? Missing<'not a path'>
    : Next<S, P, Sc, Path> extends [infer Sub, Scope]
      ? ['ok', Sub]
      : never

type Resolve<S, K extends string, F, AF> = Walk<S, K, { kind: 'filter'; prefix: '' }, F, AF, ''>

type HasIdentifier<P extends string> = P extends `${infer Seg}.${infer Rest}`
  ? Seg extends `$[${infer Id}]`
    ? Id extends ''
      ? HasIdentifier<Rest>
      : true
    : HasIdentifier<Rest>
  : P extends `$[${infer Id}]`
    ? Id extends ''
      ? false
      : true
    : false

/** Whether a path names the positional `$` twice, which MongoDB rejects (code 2). */
type TwicePositional<K extends string> = K extends `$.${infer Rest}`
  ? Rest extends Positional
    ? true
    : false
  : K extends `${string}.$.${infer Rest}`
    ? Rest extends Positional
      ? true
      : false
    : false

/**
 * The schemas a path of an update writes, one 1-tuple per type the filter allows, or why it
 * cannot be written.
 */
type Targets<S, K extends string, F, AF, Op> = string extends K
  ? 'an update key must be a literal path'
  : TwicePositional<K> extends true
    ? `"${K}": the positional $ goes once in a path`
    : [SchemaAt<S, K, 'update'>] extends [never]
      ? NotAPath<K>
      : HasIdentifier<K> extends true
        ? [AF] extends [never]
          ? `"${K}" uses an identifier: pass arrayFilters`
          : ResolvedTargets<S, K, F, AF, Op>
        : ResolvedTargets<S, K, F, AF, Op>

type ResolvedTargets<S, K extends string, F, AF, Op> =
  Resolve<S, K, F, AF> extends infer R
    ? [Extract<R, ['discriminator']>] extends [never]
      ? [Extract<R, ['missing', string]>] extends [never]
        ? R extends ['ok', infer Sub]
          ? [Sub]
          : never
        : Extract<R, ['missing', string]> extends ['missing', infer Why extends string]
          ? `"${K}" is not in every type allowed: ${Why}`
          : never
      : Op extends '$setOnInsert'
        ? [SchemaAt<S, K, 'update'>]
        : `"${K}" is the discriminator of its object: replace the object to change it`
    : never

// The value each operator takes, given the schemas it writes in every allowed type.

type IsNumber<Sub> = NonNullable<core.output<Sub>> extends bigint | number ? true : false

type IsOptional<Sub> = undefined extends core.output<Sub> ? true : false

type IsDate<Sub> = NonNullable<core.output<Sub>> extends Date ? true : false

/** A `Decimal128`, known by its `_bsontype`, as the copies of bson of the app and the driver. */
type IsDecimal<Sub> =
  NonNullable<core.output<Sub>> extends { _bsontype: 'Decimal128' } ? true : false

type IsArray<Sub> = NonNullable<core.output<Sub>> extends ReadonlyArray<unknown> ? true : false

/** Whether a schema is a set of `mz.set()`, under its wrappers. */
type IsSet<Sub> = Unwrap<Sub> extends SetMarker ? true : false

/** The first set a path goes through to reach an element of it, or `never`. */
type SetAbove<
  S,
  P extends string,
  Prefix extends string = ''
> = P extends `${infer Seg}.${infer Rest}`
  ? true extends IsSet<SchemaAt<S, `${Prefix}${Seg}`, 'update'>>
    ? `${Prefix}${Seg}`
    : SetAbove<S, Rest, `${Prefix}${Seg}.`>
  : never

type AllAre<
  T,
  Is extends 'array' | 'date' | 'decimal' | 'nullable' | 'number' | 'optional'
> = false extends (
  T extends [infer Sub]
    ? Is extends 'array'
      ? IsArray<Sub>
      : Is extends 'date'
        ? IsDate<Sub>
        : Is extends 'decimal'
          ? IsDecimal<Sub>
          : Is extends 'nullable'
            ? null extends core.output<Sub>
              ? true
              : false
            : Is extends 'number'
              ? IsNumber<Sub>
              : IsOptional<Sub>
    : never
)
  ? false
  : true

/** A value every allowed type takes, validated like an insert at runtime. */
type InputOf<T> = IntersectAll<T extends [infer Sub] ? [Loose<core.input<Sub>>] : never>

/** An element every allowed array takes. */
type ElementInputOf<T> = IntersectAll<
  T extends [infer Sub] ? [Loose<core.input<ElementSchema<Sub>>>] : never
>

type ElementOutputOf<T> = T extends [infer Sub] ? Loose<core.output<ElementSchema<Sub>>> : never

/** A segment that names an element of an array: an index, `$`, `$[]` or `$[id]`. */
type ElementSegment = `${number}` | '$' | `$[${string}]`

/** The path above the last segment, and the last segment. */
type SplitLast<
  K extends string,
  Prefix extends string = ''
> = K extends `${infer Head}.${infer Rest}` ? SplitLast<Rest, `${Prefix}${Head}.`> : [Prefix, K]

/**
 * Whether a path names an element of an array or a tuple, which `$unset` sets to `null`, as MongoDB
 * does.
 */
type NamesElement<S, K extends string> =
  SplitLast<K> extends [`${infer Parent}.`, ElementSegment]
    ? IsArray<SchemaAt<S, Parent, 'update'>>
    : false

/**
 * Whether a path names an element of an array or a tuple, or a path inside one, which `$rename`
 * neither moves nor writes, as MongoDB does (code 2).
 */
type InElement<S, K extends string> =
  NamesElement<S, K> extends true
    ? true
    : SplitLast<K> extends [`${infer Parent}.`, string]
      ? InElement<S, Parent>
      : false

type ArrayOnly<T, K extends string, Then> =
  AllAre<T, 'array'> extends true ? Then : `"${K}" is not an array`

type RenameCheck<S, T, K extends string, To> =
  InElement<S, K> extends true
    ? `"${K}" is in an array, which $rename cannot move`
    : AllAre<T, 'optional'> extends false
      ? `"${K}" is required, so it cannot be renamed`
      : To extends string
        ? [SchemaAt<S, To, 'update'>] extends [never]
          ? NotAPath<To>
          : InElement<S, To> extends true
            ? `"${To}" is in an array, which $rename cannot move to`
            : // The server moves the stored value as it is, without parsing it for its new path.
              NonNullable<core.output<T extends [infer Sub] ? Sub : never>> extends core.output<
                  SchemaAt<S, To, 'update'>
                >
              ? To
              : `"${K}" and "${To}" have different types`
        : 'takes the new path'

/** The value one operator takes at one path. `undefined` is dropped at runtime, so it compiles. */
type FieldCheck<S, Op, K extends string, T, C> = [T] extends [string]
  ? T
  : Op extends '$max' | '$min' | '$set' | '$setOnInsert'
    ? InputOf<T> | undefined
    : Op extends '$unset'
      ? NamesElement<S, K> extends true
        ? AllAre<T, 'nullable'> extends true
          ? '' | 1 | true | undefined
          : `$unset sets "${K}", an element of an array, to null, which it does not take`
        : AllAre<T, 'optional'> extends true
          ? '' | 1 | true | undefined
          : `"${K}" is required, so it cannot be unset`
      : Op extends '$inc' | '$mul'
        ? AllAre<T, 'number'> extends true
          ? number | undefined
          : AllAre<T, 'decimal'> extends true
            ? NonNullable<InputOf<T>> | undefined
            : `"${K}" is not a number`
        : Op extends '$bit'
          ? AllAre<T, 'number'> extends true
            ? { and: number } | { or: number } | { xor: number } | undefined
            : `"${K}" is not a number`
          : Op extends '$currentDate'
            ? AllAre<T, 'date'> extends true
              ? true | { $type: 'date' } | undefined
              : `"${K}" is not a date`
            : Op extends '$push'
              ? true extends (T extends [infer Sub] ? IsSet<Sub> : never)
                ? `"${K}" is a set: use $addToSet`
                : ArrayOnly<
                    T,
                    K,
                    | ElementInputOf<T>
                    | {
                        $each: ReadonlyArray<ElementInputOf<T>>
                        $position?: number
                        $slice?: number
                        $sort?: -1 | 1 | Readonly<Record<string, -1 | 1>>
                      }
                    | undefined
                  >
              : Op extends '$addToSet'
                ? ArrayOnly<
                    T,
                    K,
                    ElementInputOf<T> | { $each: ReadonlyArray<ElementInputOf<T>> } | undefined
                  >
                : Op extends '$pop'
                  ? ArrayOnly<T, K, -1 | 1 | undefined>
                  : Op extends '$pullAll'
                    ? ArrayOnly<T, K, ReadonlyArray<ElementOutputOf<T>> | undefined>
                    : Op extends '$pull'
                      ? ArrayOnly<
                          T,
                          K,
                          IntersectAll<
                            T extends [infer Sub]
                              ? [ElementConditionCheck<ElementSchema<Sub>, C>]
                              : never
                          >
                        >
                      : Op extends '$rename'
                        ? RenameCheck<S, T, K, C>
                        : never

type FieldOperator =
  | '$addToSet'
  | '$bit'
  | '$currentDate'
  | '$inc'
  | '$max'
  | '$min'
  | '$mul'
  | '$pop'
  | '$pull'
  | '$pullAll'
  | '$push'
  | '$rename'
  | '$set'
  | '$setOnInsert'
  | '$unset'

type ArrayFiltersOf<O> = O extends { arrayFilters: infer AF } ? AF : never

/**
 * The paths of the `_id`: the server rejects a change (66), so only `$setOnInsert` writes it,
 * whole. A path inside it fails as soon as the filter or another path gives a part of the `_id`.
 */
type IdPath = '_id' | `_id.${string}`

type IdProblem = 'the _id is immutable: an upsert sets it whole with $setOnInsert'

/**
 * The value a condition of a filter gives the document an upsert inserts, in a tuple, as
 * `filterEqualities` reads it: an equality, `$eq` or a `$in` of one value.
 */
type Inserted<V> = V extends RegExp | { _bsontype: 'BSONRegExp' }
  ? never
  : [Extract<keyof V, `$${string}`>] extends [never]
    ? [V]
    : V extends { $eq: infer X } | { $in: readonly [infer X] }
      ? [X]
      : never

/**
 * Why `$setOnInsert` cannot write the `_id` of an upsert whose filter gives it, which the server
 * inserts as it is: a part of it, or another value, which the server rejects (66). The same `_id`
 * passes, and a value the types cannot compare, such as a `string`, is left to the runtime.
 */
type GivenIdProblem<F, V> = [
  { [K in keyof F & `_id.${string}`]: Inserted<F[K]> }[keyof F & `_id.${string}`]
] extends [never]
  ? '_id' extends keyof F
    ? Inserted<F['_id']> extends [infer X]
      ? [Extract<V, X> | Extract<X, V>] extends [never]
        ? 'the filter gives another _id, which the upsert inserts: give the same one, or leave it out of $setOnInsert'
        : never
      : never
    : never
  : 'the filter gives a part of the _id, which the upsert inserts: leave the _id out of $setOnInsert'

type OperatorCheck<S, Op, Fields, F, AF, Locked, O> = {
  [K in keyof Fields]: K extends string
    ? K extends Locked
      ? `"${K}" is set by timestamps: pass timestamps: false to write it`
      : K extends IdPath
        ? [Op, K] extends ['$setOnInsert', '_id']
          ? O extends { upsert: true }
            ? [GivenIdProblem<F, Fields[K]>] extends [never]
              ? PathCheck<S, Op, K, Fields[K], F, AF>
              : GivenIdProblem<F, Fields[K]>
            : PathCheck<S, Op, K, Fields[K], F, AF>
          : IdProblem
        : Op extends '$rename'
          ? // `$rename` also writes the path it moves the value to.
            Fields[K] extends Locked
            ? `"${Fields[K] & string}" is set by timestamps: pass timestamps: false to write it`
            : Fields[K] extends IdPath
              ? IdProblem
              : PathCheck<S, Op, K, Fields[K], F, AF>
          : PathCheck<S, Op, K, Fields[K], F, AF>
    : never
}

/** The value one operator takes at one path, which cannot write an element of a set. */
type PathCheck<S, Op, K extends string, C, F, AF> = [SetAbove<S, K>] extends [never]
  ? FieldCheck<S, Op, K, Targets<S, K, F, AF, Op>, C>
  : `"${SetAbove<S, K>}" is a set: write it whole, or use $addToSet, $pull, $pullAll or $pop`

/** The stages MongoDB takes in an update pipeline. */
type PipelineStage = '$addFields' | '$project' | '$replaceRoot' | '$replaceWith' | '$set' | '$unset'

/** One stage of an update pipeline: its values are expressions the server computes, unchecked. */
type StageCheck<T> = keyof T extends PipelineStage
  ? T
  : 'an update pipeline takes $set, $addFields, $unset, $project, $replaceWith or $replaceRoot'

/**
 * Checks an update operator by operator and path by path: each path must exist in every type of
 * document the filter allows, and each value must fit its operator and its field. A pipeline
 * compiles with `updatePipeline: true`, stage by stage.
 */
export type UpdateCheck<S, U, F, O, N extends TimestampNames = NoTimestamps> = {
  [Op in keyof U]: U extends ReadonlyArray<unknown>
    ? O extends { updatePipeline: true }
      ? StageCheck<U[Op]>
      : 'an update with a pipeline needs updatePipeline: true'
    : Op extends FieldOperator
      ? OperatorCheck<S, Op, U[Op], F, ArrayFiltersOf<O>, LockedFields<N, Op, O>, O>
      : `"${Op & string}" is not an update operator`
}

/**
 * The paths the editor suggests under each operator, with the `_id` only under `$setOnInsert`. The
 * checks come from `UpdateCheck`.
 */
export type SuggestedUpdate<S> = {
  [Op in FieldOperator]?: Op extends '$setOnInsert'
    ? { [K in Exclude<PathSuggestions<S, 'update'>, `_id.${string}`>]?: unknown }
    : Op extends '$pull'
      ? // The condition of `$pull` is on the elements: the editor suggests their fields.
        {
          [K in Exclude<PathSuggestions<S, 'update'>, IdPath>]?: {
            [F in PathSuggestions<ElementSchema<SchemaAt<S, K, 'update'>>, 'filter'>]?: unknown
          }
        }
      : { [K in Exclude<PathSuggestions<S, 'update'>, IdPath>]?: unknown }
}

/**
 * An update of the documents of a schema, given its filter and options, for a function that takes
 * one and passes it to the model. The model's operations check `UpdateCheck` in the type parameter
 * and take `SuggestedUpdate` in the parameter, which costs less to compile.
 */
export type ModelUpdate<S, U, F, O, N extends TimestampNames = NoTimestamps> = UpdateCheck<
  S,
  U,
  F,
  O,
  N
> &
  SuggestedUpdate<S>

// `arrayFilters`: one entry per `$[id]` of the update, checked against the elements it filters.

type IdentifierAt<S, Seg extends string, Path extends string> = Seg extends `$[${infer Id}]`
  ? Id extends ''
    ? never
    : [Id, SchemaAt<S, Path, 'update'>]
  : never

type PathIdentifiers<
  S,
  P extends string,
  Prefix extends string = ''
> = P extends `${infer Seg}.${infer Rest}`
  ? IdentifierAt<S, Seg, `${Prefix}${Seg}`> | PathIdentifiers<S, Rest, `${Prefix}${Seg}.`>
  : IdentifierAt<S, P, `${Prefix}${P}`>

/** Each identifier of an update with the schema of the elements it filters. */
type Identifiers<S, U> = {
  [Op in keyof U]: {
    [K in keyof U[Op]]: K extends string ? PathIdentifiers<S, K> : never
  }[keyof U[Op]]
}[keyof U]

type EntryKeyCheck<X, K extends string, C> = K extends `${infer Id}.${infer Rest}`
  ? [Extract<X, [Id, unknown]>] extends [never]
    ? `"${Id}" is not an identifier of the update`
    : Extract<X, [Id, unknown]> extends [Id, infer E]
      ? KeyCheck<E, Rest, C>
      : never
  : [Extract<X, [K, unknown]>] extends [never]
    ? `"${K}" is not an identifier of the update`
    : Extract<X, [K, unknown]> extends [K, infer E]
      ? ConditionCheck<E, C>
      : never

type EntryCheck<X, Entry> = {
  [K in keyof Entry]: K extends string ? EntryKeyCheck<X, K, Entry[K]> : never
}

type ArrayFiltersCheck<X, AF> = { [I in keyof AF]: EntryCheck<X, AF[I]> }

/**
 * Checks the entries of `arrayFilters`. An array of them is not intersected with the driver's
 * `Document[]`, which would make the compiler compare every method of both, so each entry checks
 * that it is a document.
 */
type ArrayFiltersEntries<X, AF> =
  AF extends ReadonlyArray<unknown>
    ? { [I in keyof AF]: AF[I] extends Document ? EntryCheck<X, AF[I]> : Document }
    : ArrayFiltersCheck<X, AF>

/** Checks the entries of `arrayFilters` against the identifiers of an update. */
export type ArrayFiltersEntriesCheck<S, U, AF> = ArrayFiltersEntries<Identifiers<S, U>, AF>

/**
 * Checks the options of an update: its `arrayFilters` and, where it takes them, its `sort`, its
 * `projection` and its `populate`, given the virtuals `V` and the references `R` of the model.
 */
export type UpdateOptionsCheck<S extends ModelSchema, U, O, V = None, R = None> = {
  [K in keyof O]: K extends 'arrayFilters'
    ? ArrayFiltersEntries<Identifiers<S, U>, O[K]>
    : K extends 'sort'
      ? SortCheck<S, O[K]>
      : K extends 'projection'
        ? ProjectionCheck<S, O[K], V>
        : K extends 'populate'
          ? PopulateCheck<S, R, O[K], O extends { projection: infer P } ? P : None>
          : O[K]
}
