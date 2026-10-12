import type { Def, PathMode, Wrapper } from '../schema/schema-at'

/**
 * The paths the editor suggests, walked on the schema up to 6 levels, each object or union one, so
 * a recursive union such as `z.json()` ends. They stop at records, lazies, customs and transforms,
 * so a large `z.custom<T>()` stays out of the walk. Deeper paths still compile: they are checked
 * one by one with `SchemaAt`. Filters and projections go through arrays the same way, so they share
 * one walk.
 */
export type PathSuggestions<S, M extends PathMode> = Suggestions<
  S,
  M extends 'update' ? 'update' : 'filter'
>

/** A path with the positional `$`, which MongoDB takes once in a path. */
export type Positional = '$' | `$.${string}` | `${string}.$` | `${string}.$.${string}`

type Suggestions<S, M extends PathMode, D extends unknown[] = []> = D['length'] extends 6
  ? never
  : Def<S> extends infer X
    ? X extends { shape: infer Shape; type: 'object' }
      ? {
          [K in keyof Shape & string]: K | `${K}.${Suggestions<Shape[K], M, [...D, 1]>}`
        }[keyof Shape & string]
      : X extends { element: infer E; type: 'array' }
        ? M extends 'update'
          ? Suggestions<E, M, [...D, 1]> extends infer Sub extends string
            ? '$' | '$[]' | `$.${Exclude<Sub, Positional>}` | `$[].${Sub}`
            : never
          : Suggestions<E, M, D>
        : X extends { innerType: infer I; type: Wrapper }
          ? Suggestions<I, M, D>
          : X extends { options: infer O extends readonly unknown[]; type: 'union' }
            ? Suggestions<O[number], M, [...D, 1]>
            : never
    : never
