import type { ConditionCheck, ElementConditionCheck, ElementSchema, KeyCheck } from './filter'
import type { Loose } from './loose'
import type { PathSuggestions } from './path-suggestions'
import type { ProjectionCheck } from './projection'
import type { Def, ExtraKey, IsIdentifier, NotAPath, SchemaAt, Wrapper } from './schema-at'
import type { SortCheck } from './sort'
import type { LockedFields, NoTimestamps, TimestampNames } from './timestamps'
import type * as core from 'zod/v4/core'

type IntersectAll<T> = (T extends [infer V] ? (value: V) => void : never) extends (
  value: infer I
) => void
  ? I
  : never

/** The schema under its wrappers and lazies, option by option. */
type Unwrap<S> = S extends unknown
  ? Def<S> extends infer X
    ? X extends { innerType: infer I; type: Wrapper }
      ? Unwrap<I>
      : X extends { getter: () => infer L; type: 'lazy' }
        ? Unwrap<L>
        : S
    : never
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

type OptionWith<O, D extends string, V> = O extends unknown
  ? core.output<SchemaAt<O, D, 'filter'>> extends V
    ? O
    : never
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
            : [ExtraKey<Unwrap<S>>, Extend<Sc, Seg>]
        : X extends { type: 'record'; valueType: infer V }
          ? [V, Extend<Sc, Seg>]
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
          ? WalkStep<A, P, Sc, F, AF, Path> extends infer R
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

/**
 * The schemas a path of an update writes, one 1-tuple per type the filter allows, or why it
 * cannot be written.
 */
type Targets<S, K extends string, F, AF, Op> = string extends K
  ? 'an update key must be a literal path'
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
        : `"${K}" changes the type of its object: replace the object`
    : never

// The value each operator takes, given the schemas it writes in every allowed type.

type IsNumber<Sub> = NonNullable<core.output<Sub>> extends bigint | number ? true : false

type IsOptional<Sub> = undefined extends core.output<Sub> ? true : false

type IsDate<Sub> = NonNullable<core.output<Sub>> extends Date ? true : false

type IsArray<Sub> = NonNullable<core.output<Sub>> extends ReadonlyArray<unknown> ? true : false

type AllAre<T, Is extends 'array' | 'date' | 'number' | 'optional'> = false extends (
  T extends [infer Sub]
    ? Is extends 'array'
      ? IsArray<Sub>
      : Is extends 'date'
        ? IsDate<Sub>
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

type ArrayOnly<T, K extends string, Then> =
  AllAre<T, 'array'> extends true ? Then : `"${K}" is not an array`

type RenameCheck<S, T, K extends string, To> =
  AllAre<T, 'optional'> extends false
    ? `"${K}" is required, so it cannot be renamed`
    : To extends string
      ? [SchemaAt<S, To, 'update'>] extends [never]
        ? NotAPath<To>
        : NonNullable<core.output<T extends [infer Sub] ? Sub : never>> extends core.input<
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
      ? AllAre<T, 'optional'> extends true
        ? '' | 1 | true | undefined
        : `"${K}" is required, so it cannot be unset`
      : Op extends '$inc' | '$mul'
        ? AllAre<T, 'number'> extends true
          ? number | undefined
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
              ? ArrayOnly<
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

type OperatorCheck<S, Op, Fields, F, AF, Locked> = {
  [K in keyof Fields]: K extends string
    ? K extends Locked
      ? `"${K}" is set by timestamps: pass timestamps: false to write it`
      : FieldCheck<S, Op, K, Targets<S, K, F, AF, Op>, Fields[K]>
    : never
}

/**
 * Checks an update operator by operator and path by path: each path must exist in every type of
 * document the filter allows, and each value must fit its operator and its field.
 */
export type UpdateCheck<S, U, F, O, N extends TimestampNames = NoTimestamps> = {
  [Op in keyof U]: U extends ReadonlyArray<unknown>
    ? 'an update with a pipeline does not compile: use .collection'
    : Op extends FieldOperator
      ? OperatorCheck<S, Op, U[Op], F, ArrayFiltersOf<O>, LockedFields<N, Op, O>>
      : `"${Op & string}" is not an update operator`
}

/** The paths the editor suggests under each operator. The checks come from `UpdateCheck`. */
export type SuggestedUpdate<S> = {
  [Op in FieldOperator]?: { [K in PathSuggestions<S, 'update'>]?: unknown }
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

/** Checks the entries of `arrayFilters` against the identifiers of an update. */
export type ArrayFiltersEntriesCheck<S, U, AF> = ArrayFiltersCheck<Identifiers<S, U>, AF>

/**
 * Checks the options of an update: its `arrayFilters` and, where it takes them, its `sort` and its
 * `projection`.
 */
export type UpdateOptionsCheck<S, U, O> = {
  [K in keyof O]: K extends 'arrayFilters'
    ? ArrayFiltersCheck<Identifiers<S, U>, O[K]>
    : K extends 'sort'
      ? SortCheck<S, O[K]>
      : K extends 'projection'
        ? ProjectionCheck<S, O[K]>
        : O[K]
}
