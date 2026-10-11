import type { Def, FieldAt, NotAPath, Wrapper } from '../schema/schema-at'
import type { UndefinedIfOptional } from '../utils/type-helpers'
import type { Leaf, Loose } from './loose'
import type { PathSuggestions } from './path-suggestions'
import type { Binary, BSONRegExp, BSONType, BSONTypeAlias, Document } from 'mongodb'
import type * as core from 'zod/v4/core'

export type Element<V> = V extends ReadonlyArray<infer E> ? E : never

/** What a condition on a field matches: its value or, in an array, each element. */
type Matchable<V> = NonNullable<V> | Element<NonNullable<V>>

export type Has<V, T> = [Extract<Matchable<V>, T>] extends [never] ? false : true

export type IsArray<V> = [Extract<NonNullable<V>, ReadonlyArray<unknown>>] extends [never]
  ? false
  : true

/**
 * A value to compare a field with: its type or, in an array, an element's. A regular expression
 * matches strings, and `null` matches a field that is missing or `null`. `undefined` is not a
 * value: the driver would send it as `null`.
 */
type Value<V> =
  | Loose<Matchable<V>>
  | (Has<V, string> extends true ? BSONRegExp | RegExp : never)
  | (null extends V ? null : undefined extends V ? null : never)

/** What `$gt`, `$gte`, `$lt` and `$lte` compare: anything but booleans and objects. */
export type Comparable<V> =
  Matchable<V> extends infer M ? (M extends boolean ? never : M extends Leaf ? M : never) : never

/** An object with operators, as opposed to a value to compare with. */
type IsOperators<C> = C extends Leaf | ReadonlyArray<unknown>
  ? false
  : [keyof C] extends [never]
    ? false
    : [Exclude<keyof C, `$${string}`>] extends [never]
      ? true
      : false

/** The schema of the elements of an array. */
export type ElementSchema<T> =
  Def<T> extends infer X
    ? X extends { innerType: infer I; type: Wrapper }
      ? ElementSchema<I>
      : X extends { getter: () => infer L; type: 'lazy' }
        ? ElementSchema<L>
        : X extends { element: infer E; type: 'array' }
          ? E
          : X extends { options: infer O extends readonly unknown[]; type: 'union' }
            ? ElementSchema<O[number]>
            : never
    : never

/** The operators that take geospatial shapes, typed like the driver does. */
interface GeoOperators {
  $geoIntersects: { $geometry: Document }
  $geoWithin: Document
  $maxDistance: number
  $minDistance: number
  $near: Document
  $nearSphere: Document
}

type BitwiseOperator = '$bitsAllClear' | '$bitsAllSet' | '$bitsAnyClear' | '$bitsAnySet'

type Only<Applies, Then, Message extends string> = Applies extends true ? Then : Message

/** `$elemMatch` takes operators on the element, or a filter on its fields. */
type ElemMatchCheck<E, C> = IsOperators<C> extends true ? OperatorsCheck<E, C> : FilterCheck<E, C>

/**
 * A condition on the elements of an array, as `$pull` takes it: operators, a value, or a filter on
 * the fields of an element that is an object.
 */
export type ElementConditionCheck<E, C> =
  IsOperators<C> extends true
    ? OperatorsCheck<E, C>
    : C extends Leaf
      ? Value<core.output<E>>
      : FilterCheck<E, C>

/** `$not` takes operators or a regular expression. */
type NotCheck<T, C> = C extends BSONRegExp | RegExp
  ? Only<Has<core.output<T>, string>, C, '"$not" takes a regular expression only on strings'>
  : IsOperators<C> extends true
    ? OperatorsCheck<T, C>
    : '"$not" takes operators or a regular expression'

/** The value one operator takes on the field whose schema is `T`. */
type OperatorCheck<T, Op, C, V = core.output<T>> = Op extends '$eq' | '$ne'
  ? Value<V>
  : Op extends '$in' | '$nin'
    ? ReadonlyArray<Value<V>>
    : Op extends '$gt' | '$gte' | '$lt' | '$lte'
      ? [Comparable<V>] extends [never]
        ? `"${Op}" compares numbers, strings, dates and ids`
        : Loose<Comparable<V>>
      : Op extends '$exists'
        ? boolean
        : Op extends '$type'
          ? BSONType | BSONTypeAlias | ReadonlyArray<BSONType | BSONTypeAlias>
          : Op extends '$regex'
            ? Only<Has<V, string>, BSONRegExp | RegExp | string, '"$regex" only applies to strings'>
            : Op extends '$options'
              ? Only<Has<V, string>, string, '"$options" only applies to strings'>
              : Op extends '$not'
                ? NotCheck<T, C>
                : Op extends '$mod'
                  ? Only<
                      Has<V, number>,
                      readonly [number, number],
                      '"$mod" only applies to numbers'
                    >
                  : Op extends '$all'
                    ? Only<
                        IsArray<V>,
                        ReadonlyArray<Loose<Element<NonNullable<V>>>>,
                        '"$all" only applies to arrays'
                      >
                    : Op extends '$size'
                      ? Only<IsArray<V>, number, '"$size" only applies to arrays'>
                      : Op extends '$elemMatch'
                        ? Only<
                            IsArray<V>,
                            ElemMatchCheck<ElementSchema<T>, C>,
                            '"$elemMatch" only applies to arrays'
                          >
                        : Op extends BitwiseOperator
                          ? Only<
                              Has<V, number | Binary>,
                              number | Binary | ReadonlyArray<number>,
                              `"${Op}" only applies to numbers and binaries`
                            >
                          : Op extends keyof GeoOperators
                            ? GeoOperators[Op]
                            : `"${Op & string}" is not a query operator`

type OperatorsCheck<T, C> = { [Op in keyof C]: OperatorCheck<T, Op, Exclude<C[Op], undefined>> }

/** A condition on one field: a value, or an object with operators. */
export type ConditionCheck<T, C> = C extends unknown
  ? IsOperators<C> extends true
    ? OperatorsCheck<T, C>
    : Value<core.output<T>>
  : never

/** Checks one key of a filter and its condition. */
export type KeyCheck<S, K extends string, C> = string extends K
  ? 'a filter key must be a literal path'
  : K extends `$${string}`
    ? `"${K}" is not a filter operator`
    : [FieldAt<S, K, 'filter'>] extends [never]
      ? NotAPath<K>
      : ConditionCheck<FieldAt<S, K, 'filter'>, C>

/** The operators at the top level of a filter, besides `$and`, `$nor` and `$or`. */
interface RootOperators<S> {
  $comment: Document | string
  $expr: Document
  $jsonSchema: Document
  $text: {
    $caseSensitive?: boolean
    $diacriticSensitive?: boolean
    $language?: string
    $search: string
  }
  $where: string | ((this: core.output<S>) => boolean)
}

type FiltersCheck<S, A> =
  A extends ReadonlyArray<unknown>
    ? { [I in keyof A]: FilterCheck<S, A[I]> }
    : 'takes an array of filters'

/**
 * Checks a filter key by key against the schema: each path must exist, and each condition must
 * fit the field, with every query operator of MongoDB.
 */
export type FilterCheck<S, F> = {
  [K in keyof F]:
    | (K extends '$and' | '$nor' | '$or'
        ? FiltersCheck<S, F[K]>
        : K extends keyof RootOperators<S>
          ? RootOperators<S>[K]
          : K extends string
            ? KeyCheck<S, K, F[K]>
            : never)
    | UndefinedIfOptional<F, K>
}

/** The keys the editor suggests in a filter. The checks come from `FilterCheck`. */
export type SuggestedFilter<S> = {
  [
    K in PathSuggestions<S, 'filter'> | '_id' | '$and' | '$nor' | '$or' | keyof RootOperators<S>
  ]?: unknown
}

/**
 * A filter on the documents of a schema, for a function that takes one and passes it to the model.
 * The model's operations check `FilterCheck` in the type parameter and take `SuggestedFilter` in
 * the parameter, which costs less to compile.
 */
export type ModelFilter<S, F> = FilterCheck<S, F> & SuggestedFilter<S>
