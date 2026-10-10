import { z } from 'zod'
import * as core from 'zod/v4/core'

import { unwrapSchema } from './unwrap-schema'

/**
 * How an operation reads the arrays of a path. A filter goes through them and takes an index. An
 * update names the element with an index, `$`, `$[]` or `$[id]`. A projection only goes through
 * them, because MongoDB takes an index as a field name there.
 */
export type PathMode = 'filter' | 'projection' | 'update'

type Def<S> = S extends { _zod: { def: infer D } } ? D : never

type Wrapper =
  | 'catch'
  | 'default'
  | 'nonoptional'
  | 'nullable'
  | 'optional'
  | 'prefault'
  | 'readonly'

// oxfmt-ignore
type Lower =
  | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm'
  | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z'

type Alphanumeric =
  | Lower
  | Uppercase<Lower>
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'

type IsAlphanumeric<S extends string> = S extends ''
  ? true
  : S extends `${infer C}${infer R}`
    ? C extends Alphanumeric
      ? IsAlphanumeric<R>
      : false
    : false

/** An `arrayFilters` identifier: a lowercase letter, then letters and digits. */
type IsIdentifier<S extends string> = S extends `${infer C}${infer R}`
  ? C extends Lower
    ? IsAlphanumeric<R>
    : false
  : false

/**
 * A key that an object with `.catchall()`, or a loose object, accepts besides its shape. The types
 * of the object only keep the catchall's input and output, so the key works like `z.unknown()`
 * with those types.
 */
type ExtraKey<S> = S extends { _zod: { config: { in: infer I; out: infer O } } }
  ? string extends keyof O
    ? { _zod: { def: { type: 'unknown' }; input: I[keyof I]; output: O[keyof O] } }
    : never
  : never

type ArrayStep<E, Seg extends string, M extends PathMode> = M extends 'projection'
  ? Seg extends `${number}` | `$${string}`
    ? never
    : Step<E, Seg, M>
  : M extends 'update'
    ? Seg extends `${number}` | '$' | '$[]'
      ? E
      : Seg extends `$[${infer Id}]`
        ? IsIdentifier<Id> extends true
          ? E
          : never
        : never
    : Seg extends `${number}`
      ? E
      : Step<E, Seg, M>

/**
 * The schema one segment leads to, or `never`. Anything goes under `z.unknown()` and `z.any()`,
 * and paths stop at transforms and `z.custom()`, which have no schema for what is inside.
 */
type Step<S, Seg extends string, M extends PathMode> =
  Def<S> extends infer X
    ? X extends { innerType: infer I; type: Wrapper }
      ? Step<I, Seg, M>
      : X extends { getter: () => infer L; type: 'lazy' }
        ? Step<L, Seg, M>
        : X extends { type: 'any' | 'unknown' }
          ? S
          : X extends { options: infer O extends readonly unknown[]; type: 'union' }
            ? Step<O[number], Seg, M>
            : X extends { shape: infer Shape; type: 'object' }
              ? Seg extends keyof Shape
                ? Shape[Seg]
                : ExtraKey<S>
              : X extends { keyType: infer K; type: 'record'; valueType: infer V }
                ? Seg extends core.output<K>
                  ? V
                  : never
                : X extends { element: infer E; type: 'array' }
                  ? ArrayStep<E, Seg, M>
                  : never
    : never

/**
 * The schema at a dot path, or `never` when the path does not exist. Each key written in the code
 * is looked up this way, like the runtime does, so there is no depth limit.
 */
export type SchemaAt<
  S,
  P extends string,
  M extends PathMode
> = P extends `${infer Seg}.${infer Rest}` ? SchemaAt<Step<S, Seg, M>, Rest, M> : Step<S, P, M>

/** An `arrayFilters` identifier, as the MongoDB manual defines it. */
const IDENTIFIER = /^\$\[[a-z][a-zA-Z0-9]*\]$/

const INDEX = /^\d+$/

function step(schema: core.$ZodType, segment: string, mode: PathMode): core.$ZodType[] {
  const unwrapped = unwrapSchema(schema)

  if (unwrapped instanceof core.$ZodAny || unwrapped instanceof core.$ZodUnknown) return [unwrapped]

  if (unwrapped instanceof core.$ZodUnion) {
    return unwrapped._zod.def.options.flatMap((option) => step(option, segment, mode))
  }

  if (unwrapped instanceof core.$ZodObject) {
    const { catchall, shape } = unwrapped._zod.def
    const field = Object.hasOwn(shape, segment) ? shape[segment] : catchall

    return field && !(field instanceof core.$ZodNever) ? [field] : []
  }

  if (unwrapped instanceof core.$ZodRecord) {
    const { keyType, valueType } = unwrapped._zod.def

    return z.safeParse(keyType, segment).success ? [valueType] : []
  }

  if (!(unwrapped instanceof core.$ZodArray)) return []

  const { element } = unwrapped._zod.def

  if (mode === 'projection') {
    return INDEX.test(segment) || segment.startsWith('$') ? [] : step(element, segment, mode)
  }

  if (INDEX.test(segment)) return [element]
  if (mode === 'filter') return step(element, segment, mode)

  return segment === '$' || segment === '$[]' || IDENTIFIER.test(segment) ? [element] : []
}

/**
 * The schemas a dot path leads to, the runtime half of `SchemaAt`: several through a union, none
 * when the path does not exist.
 */
export function schemaAt(schema: core.$ZodType, path: string, mode: PathMode): core.$ZodType[] {
  return path
    .split('.')
    .reduce<core.$ZodType[]>(
      (schemas, segment) => schemas.flatMap((current) => step(current, segment, mode)),
      [schema]
    )
}
