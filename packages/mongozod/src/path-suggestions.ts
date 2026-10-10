import type { Def, PathMode, Wrapper } from './schema-at'

/**
 * The paths the editor suggests, walked on the schema up to 6 levels. They stop at records, lazies,
 * customs and transforms, so a large `z.custom<T>()` stays out of the walk. Deeper paths still
 * compile: they are checked one by one with `SchemaAt`.
 */
export type PathSuggestions<S, M extends PathMode, D extends unknown[] = []> = D['length'] extends 6
  ? never
  : Def<S> extends infer X
    ? X extends { shape: infer Shape; type: 'object' }
      ? {
          [K in keyof Shape & string]: K | `${K}.${PathSuggestions<Shape[K], M, [...D, 1]>}`
        }[keyof Shape & string]
      : X extends { element: infer E; type: 'array' }
        ? M extends 'update'
          ? '$[]' | `$[].${PathSuggestions<E, M, [...D, 1]>}`
          : PathSuggestions<E, M, D>
        : X extends { innerType: infer I; type: Wrapper }
          ? PathSuggestions<I, M, D>
          : X extends { options: infer O extends readonly unknown[]; type: 'union' }
            ? PathSuggestions<O[number], M, D>
            : never
    : never
