import type { ElementConditionCheck, ElementSchema } from './filter'
import type { Leaf } from './loose'
import type { PathSuggestions } from './path-suggestions'
import type { Def, FieldAt, NotAPath, Wrapper } from './schema-at'

type Simplify<T> = { [K in keyof T]: T[K] }

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (
  x: infer I
) => void
  ? I
  : never

type IsUnion<T> = [T] extends [UnionToIntersection<T>] ? false : true

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

type IsArraySchema<S> = [S] extends [never]
  ? false
  : Def<Unwrap<S>> extends { type: 'array' }
    ? true
    : false

type ProjectionAt<S, P extends string> = FieldAt<S, P, 'projection'>

/** Whether a path goes through an array before its last segment. */
type CrossesArray<S, P extends string> = P extends `${infer Seg}.${infer Rest}`
  ? IsArraySchema<S> extends true
    ? true
    : CrossesArray<ProjectionAt<S, Seg>, Rest>
  : IsArraySchema<S>

type Kind = 'elemMatch' | 'exclude' | 'include' | 'meta' | 'positional' | 'slice'

/** Every [path, kind] of a projection, dotted or nested. */
type Entries<P, Prefix extends string = ''> = {
  [K in keyof P & string]-?: P[K] extends 0 | false
    ? [`${Prefix}${K}`, 'exclude']
    : P[K] extends 1 | true
      ? K extends `${infer Base}.$`
        ? [`${Prefix}${Base}`, 'positional']
        : [`${Prefix}${K}`, 'include']
      : P[K] extends { $slice: unknown }
        ? [`${Prefix}${K}`, 'slice']
        : P[K] extends { $elemMatch: unknown }
          ? [`${Prefix}${K}`, 'elemMatch']
          : P[K] extends { $meta: unknown }
            ? [`${Prefix}${K}`, 'meta']
            : P[K] extends object
              ? Entries<P[K], `${Prefix}${K}.`>
              : never
}[keyof P & string]

type PathOf<E> = E extends [infer Path extends string, Kind] ? Path : never

type KindsBesidesId<E> = E extends [infer Path, infer K] ? (Path extends '_id' ? never : K) : never

type Collides<K extends string, E> = [Extract<PathOf<E>, `${K}.${string}`>] extends [never]
  ? K extends `${PathOf<E>}.${string}`
    ? true
    : false
  : true

type Mixes<K extends string, Own extends Kind, E> = K extends '_id'
  ? false
  : Own extends 'include' | 'positional'
    ? 'exclude' extends KindsBesidesId<E>
      ? true
      : false
    : Own extends 'exclude'
      ? [Extract<KindsBesidesId<E>, 'include' | 'positional'>] extends [never]
        ? false
        : true
      : false

type Problem<K extends string, Own extends Kind, E> =
  Collides<K, E> extends true
    ? `"${K}" collides with another path of the projection`
    : Mixes<K, Own, E> extends true
      ? `"${K}" mixes inclusion and exclusion`
      : never

type ValueCheck<S, K extends string, V, E> = K extends `${infer Base}.$`
  ? V extends 0 | false
    ? `"${K}" can only include`
    : [ProjectionAt<S, Base>] extends [never]
      ? NotAPath<Base>
      : IsArraySchema<ProjectionAt<S, Base>> extends false
        ? `"${Base}" is not an array`
        : CrossesArray<S, Base> extends true
          ? `"${K}" goes through another array`
          : IsUnion<Extract<E, [string, 'positional']>> extends true
            ? 'only one positional projection is allowed'
            : [Problem<Base, 'positional', E>] extends [never]
              ? V
              : Problem<Base, 'positional', E>
  : [ProjectionAt<S, K>] extends [never]
    ? NotAPath<K>
    : [Problem<K, V extends 0 | false ? 'exclude' : 'include', E>] extends [never]
      ? V
      : Problem<K, V extends 0 | false ? 'exclude' : 'include', E>

type SliceCheck<S, K extends string, E> = [ProjectionAt<S, K>] extends [never]
  ? NotAPath<K>
  : IsArraySchema<ProjectionAt<S, K>> extends false
    ? `"${K}" is not an array`
    : [Problem<K, 'slice', E>] extends [never]
      ? { $slice: number | readonly [number, number] }
      : Problem<K, 'slice', E>

type ElemMatchCheck<S, K extends string, C, E> = K extends `${string}.${string}`
  ? `$elemMatch only projects a top-level array, not "${K}"`
  : [ProjectionAt<S, K>] extends [never]
    ? NotAPath<K>
    : IsArraySchema<ProjectionAt<S, K>> extends false
      ? `"${K}" is not an array`
      : [Problem<K, 'elemMatch', E>] extends [never]
        ? { $elemMatch: ElementConditionCheck<ElementSchema<ProjectionAt<S, K>>, C> }
        : Problem<K, 'elemMatch', E>

type Check<S, P, E, Prefix extends string> = {
  [K in keyof P]: K extends string
    ? Exclude<P[K], undefined> extends 0 | 1 | boolean
      ? ValueCheck<S, `${Prefix}${K}`, Exclude<P[K], undefined>, E>
      : P[K] extends { $slice: unknown }
        ? SliceCheck<S, `${Prefix}${K}`, E>
        : P[K] extends { $elemMatch: infer C }
          ? ElemMatchCheck<S, `${Prefix}${K}`, C, E>
          : P[K] extends { $meta: unknown }
            ? { $meta: 'textScore' }
            : P[K] extends object
              ? Check<S, P[K], E, `${Prefix}${K}.`>
              : `"${Prefix}${K}" takes 0, 1, true, false, $slice, $elemMatch or $meta`
    : never
}

/**
 * Checks a projection key by key, dotted or nested, the way MongoDB 8.2 answers it: what the
 * server accepts but answers differently, such as an index or a string, does not compile.
 */
export type ProjectionCheck<S, P> = Check<S, P, Entries<P>, ''>

/** The keys the editor suggests in a projection. The checks come from `ProjectionCheck`. */
export type SuggestedProjection<S> = {
  [K in PathSuggestions<S, 'projection'> | '_id']?: unknown
}

// The document a projection returns.

type Head<E> = E extends [`${infer H}.${string}`, Kind]
  ? H
  : E extends [infer H extends string, Kind]
    ? H
    : never

type Tail<E, K extends string> = E extends [`${K}.${infer Rest}`, infer Own] ? [Rest, Own] : never

type LeafKind<E, K extends string> = E extends [K, infer Own] ? Own : never

type IsOptional<T, K extends keyof T> = Pick<T, K> extends Required<Pick<T, K>> ? false : true

/** Inclusion: only the projected paths. A parent that is `null` is left out, as MongoDB does. */
type Include<T, E> =
  T extends ReadonlyArray<infer El>
    ? Include<El, E>[]
    : T extends Leaf
      ? T
      : Simplify<
          {
            [
              K in keyof T as K extends Head<E>
                ? IncludedOptional<T, K, E> extends true
                  ? never
                  : K
                : never
            ]: IncludeValue<T[K], E, K & string>
          } & {
            [
              K in keyof T as K extends Head<E>
                ? IncludedOptional<T, K, E> extends true
                  ? K
                  : never
                : never
            ]?: IncludeValue<T[K], E, K & string>
          }
        >

type IncludedOptional<T, K extends keyof T, E> =
  IsOptional<T, K> extends true
    ? true
    : [LeafKind<E, K & string>] extends [never]
      ? null extends T[K]
        ? true
        : false
      : [LeafKind<E, K & string>] extends ['elemMatch']
        ? true
        : false

type IncludeValue<V, E, K extends string> = [LeafKind<E, K>] extends [never]
  ? Include<Exclude<V, null | undefined>, Tail<E, K>>
  : V

/** Exclusion: everything but the excluded paths. */
type ExcludePaths<T, E> =
  T extends ReadonlyArray<infer El>
    ? ExcludePaths<El, E>[]
    : T extends Leaf
      ? T
      : Simplify<
          {
            [
              K in keyof T as [LeafKind<E, K & string>] extends [never]
                ? K
                : [LeafKind<E, K & string>] extends ['exclude' | 'elemMatch']
                  ? never
                  : K
            ]: K extends Head<E>
              ? [LeafKind<E, K & string>] extends [never]
                ?
                    | ExcludePaths<Exclude<T[K], null | undefined>, Tail<E, K & string>>
                    | Extract<T[K], null | undefined>
                : T[K]
              : T[K]
          } & {
            [
              K in keyof T as [LeafKind<E, K & string>] extends [never]
                ? never
                : [LeafKind<E, K & string>] extends ['elemMatch']
                  ? K
                  : never
            ]?: T[K]
          }
        >

type Mode<E> = [Extract<KindsBesidesId<E>, 'include' | 'positional'>] extends [never]
  ? 'exclude' extends KindsBesidesId<E>
    ? 'exclusion'
    : 'slice' extends KindsBesidesId<E>
      ? 'exclusion'
      : 'elemMatch' extends KindsBesidesId<E>
        ? 'inclusion'
        : 'exclusion'
  : 'inclusion'

/** The entries that shape the document: `$meta` adds a field of its own. */
type Shaping<E> = E extends ['_id', Kind] | [string, 'meta'] ? never : E

/** The fields `{ $meta: 'textScore' }` adds, with the relevance of a text search. */
type MetaFields<E> = { [K in E extends [infer Path extends string, 'meta'] ? Path : never]: number }

type IsSingle<V> = [V] extends [0]
  ? true
  : [V] extends [1]
    ? true
    : [V] extends [true]
      ? true
      : [V] extends [false]
        ? true
        : false

/** Whether the projection is written in the code, with every key and value known. */
type IsLiteral<P> = {
  [K in keyof P]-?: IsOptional<P, K> extends true
    ? false
    : P[K] extends { $elemMatch: unknown } | { $meta: unknown } | { $slice: unknown }
      ? true
      : P[K] extends object
        ? IsLiteral<P[K]>
        : IsSingle<P[K]>
}[keyof P] extends true
  ? true
  : false

/** A projection that arrives at runtime: any field on its paths may be left out. */
type Loosen<T, W extends string> =
  T extends ReadonlyArray<infer El>
    ? Loosen<El, W>[]
    : T extends Leaf
      ? T
      : {
          [K in keyof T]?: K extends (W extends `${infer H}.${string}` ? H : W)
            ? K extends W
              ? T[K]
              :
                  | Loosen<
                      Exclude<T[K], null | undefined>,
                      W extends `${K & string}.${infer Rest}` ? Rest : never
                    >
                  | Extract<T[K], null>
            : T[K]
        }

type RuntimeProjected<O, W extends string> = '_id' extends W
  ? Simplify<Loosen<O, W>>
  : Simplify<Pick<O, '_id' & keyof O> & Loosen<Omit<O, '_id'>, W>>

/** One type of document: a discriminated union at the root is projected type by type. */
type ProjectedOption<O, P> =
  IsLiteral<P> extends false
    ? RuntimeProjected<O, keyof P & string>
    : Simplify<
        MetaFields<Entries<P>> &
          (Mode<Entries<P>> extends 'inclusion'
            ? ['_id', 'exclude'] extends Entries<P>
              ? Include<Omit<O, '_id'>, Shaping<Entries<P>>>
              : Pick<O, '_id' & keyof O> & Include<Omit<O, '_id'>, Shaping<Entries<P>>>
            : ['_id', 'exclude'] extends Entries<P>
              ? ExcludePaths<Omit<O, '_id'>, Shaping<Entries<P>>>
              : ExcludePaths<O, Shaping<Entries<P>>>)
      >

/**
 * The document a projection returns, following MongoDB 8.2. Without a projection, or with an empty
 * one, the whole document.
 */
export type Projected<O, P> = [keyof P] extends [never]
  ? O
  : O extends unknown
    ? ProjectedOption<O, P>
    : never
