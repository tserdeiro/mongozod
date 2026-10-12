import type { ObjectId } from 'bson'

import { z } from 'zod'
import * as core from 'zod/v4/core'

import { variants } from './schema-kinds'
import { unwrapSchema } from './unwrap-schema'

/**
 * How an operation reads the arrays of a path. A filter goes through them and takes an index. An
 * update names the element with an index, `$`, `$[]` or `$[id]`. A projection only goes through
 * them, because MongoDB takes an index as a field name there.
 */
export type PathMode = 'filter' | 'projection' | 'update'

/** The definition of a schema, which says what kind of schema it is. */
export type Def<S> = S extends { _zod: { def: infer D } } ? D : never

/** The schemas that wrap another one without changing its paths. */
export type Wrapper =
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
export type IsIdentifier<S extends string> = S extends `${infer C}${infer R}`
  ? C extends Lower
    ? IsAlphanumeric<R>
    : false
  : false

/**
 * A key that an object with `.catchall()`, or a loose object, accepts besides its shape. The types
 * of the object only keep the catchall's input and output, so the key works like `z.unknown()`
 * with those types.
 */
export type ExtraKey<S> = S extends { _zod: { config: { in: infer I; out: infer O } } }
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
 * The schema at an index of a tuple: its item, or its rest past the items, and `never` out of
 * range. Filters and updates take an index; a projection takes it as a field name.
 */
export type TupleStep<Items, Rest, Seg extends string> = Seg extends keyof Items & `${number}`
  ? Items[Seg]
  : Seg extends `${number}`
    ? Exclude<Rest, null>
    : never

/**
 * The schema one segment leads to, or `never`. Anything goes under `z.unknown()` and `z.any()`,
 * and paths stop at transforms and `z.custom()`, which have no schema for what is inside. Objects,
 * the most common step, go first: each definition has its own `type`, so the order does not change
 * the result.
 */
type Step<S, Seg extends string, M extends PathMode> =
  Def<S> extends infer X
    ? X extends { shape: infer Shape; type: 'object' }
      ? Seg extends keyof Shape
        ? Shape[Seg]
        : ExtraKey<S>
      : X extends { innerType: infer I; type: Wrapper }
        ? Step<I, Seg, M>
        : X extends { element: infer E; type: 'array' }
          ? ArrayStep<E, Seg, M>
          : X extends { options: infer O extends readonly unknown[]; type: 'union' }
            ? Step<O[number], Seg, M>
            : X extends { getter: () => infer L; type: 'lazy' }
              ? Step<L, Seg, M>
              : X extends { type: 'any' | 'unknown' }
                ? S
                : X extends { keyType: infer K; type: 'record'; valueType: infer V }
                  ? Seg extends core.output<K>
                    ? V
                    : never
                  : X extends { items: infer Items; rest: infer Rest; type: 'tuple' }
                    ? M extends 'projection'
                      ? never
                      : TupleStep<Items, Rest, Seg>
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

/** The error a check shows for a key that is not a path of the document. */
export type NotAPath<K extends string> = `"${K}" is not a path of the document`

/** The `_id` the driver generates when the schema does not declare one. */
interface ObjectIdSchema {
  _zod: { def: { type: 'custom' }; input: ObjectId; output: ObjectId }
}

/**
 * `SchemaAt` on a stored document, which always has an `_id`: an `ObjectId` when the schema does
 * not declare one.
 */
export type FieldAt<S, P extends string, M extends PathMode> = P extends '_id'
  ? [SchemaAt<S, P, M>] extends [never]
    ? ObjectIdSchema
    : SchemaAt<S, P, M>
  : SchemaAt<S, P, M>

/** An `arrayFilters` identifier, as the MongoDB manual defines it, with the id in its group. */
export const IDENTIFIER = /^\$\[([a-z][a-zA-Z0-9]*)\]$/

const INDEX = /^\d+$/

/** A schema one segment leads to, and whether the segment names an element of an array. */
export type Next = [schema: core.$ZodType, element: boolean]

/** The schemas one segment leads to: several through a union, none when it does not exist. */
export function step(schema: core.$ZodType, segment: string, mode: PathMode): Next[] {
  const unwrapped = unwrapSchema(schema)

  if (unwrapped instanceof core.$ZodAny || unwrapped instanceof core.$ZodUnknown) {
    return [[unwrapped, false]]
  }

  if (unwrapped instanceof core.$ZodUnion) {
    return unwrapped._zod.def.options.flatMap((option) => step(option, segment, mode))
  }

  if (unwrapped instanceof core.$ZodObject) {
    const { catchall, shape } = unwrapped._zod.def
    const field = Object.hasOwn(shape, segment) ? shape[segment] : catchall

    return field && !(field instanceof core.$ZodNever) ? [[field, false]] : []
  }

  if (unwrapped instanceof core.$ZodRecord) {
    const { keyType, valueType } = unwrapped._zod.def

    return z.safeParse(keyType, segment).success ? [[valueType, false]] : []
  }

  if (unwrapped instanceof core.$ZodTuple) {
    const { items, rest } = unwrapped._zod.def
    const item = INDEX.test(segment) && mode !== 'projection' && (items[Number(segment)] ?? rest)

    return item ? [[item, true]] : []
  }

  if (!(unwrapped instanceof core.$ZodArray)) return []

  const { element } = unwrapped._zod.def

  if (mode === 'projection') {
    return INDEX.test(segment) || segment.startsWith('$') ? [] : step(element, segment, mode)
  }

  if (INDEX.test(segment)) return [[element, true]]
  if (mode === 'filter') return step(element, segment, mode)

  return segment === '$' || segment === '$[]' || IDENTIFIER.test(segment) ? [[element, true]] : []
}

/**
 * The schemas a dot path leads to, the runtime half of `SchemaAt`: several through a union, none
 * when the path does not exist.
 */
export function schemaAt(schema: core.$ZodType, path: string, mode: PathMode): core.$ZodType[] {
  return path
    .split('.')
    .reduce<core.$ZodType[]>(
      (schemas, segment) =>
        schemas.flatMap((current) => step(current, segment, mode).map(([next]) => next)),
      [schema]
    )
}

/**
 * Whether the last segment of a path is a key its object may lack, which `$unset` can remove: a key
 * of a record whose keys are not a fixed set, as Zod checks them, such as `z.record(z.string(),
 * …)`, or a key that a catchall takes.
 */
export function isDynamicKey(schema: core.$ZodType, path: string): boolean {
  const segments = path.split('.')
  const key = segments.pop() ?? ''
  const parents = segments.length > 0 ? schemaAt(schema, segments.join('.'), 'update') : [schema]
  const holders = parents.flatMap(variants)

  return (
    holders.length > 0 &&
    holders.every((holder) => {
      if (holder instanceof core.$ZodRecord) {
        return !holder._zod.def.keyType._zod.values || holder._zod.def.partial === true
      }

      if (!(holder instanceof core.$ZodObject)) return false

      const { catchall, shape } = holder._zod.def

      return !Object.hasOwn(shape, key) && !!catchall && !(catchall instanceof core.$ZodNever)
    })
  )
}

/** A segment that names an element of an array: an index, `$`, `$[]` or `$[id]`. */
const ELEMENT = /^(?:\d+|\$(?:\[[a-zA-Z0-9]*\])?)$/

/**
 * Whether the last segment of an update path names an element of an array or a tuple, which
 * `$unset` sets to `null`, as MongoDB does.
 */
export function namesElement(schema: core.$ZodType, path: string): boolean {
  const segments = path.split('.')
  const last = segments.pop() ?? ''

  return (
    ELEMENT.test(last) &&
    segments.length > 0 &&
    schemaAt(schema, segments.join('.'), 'update')
      .flatMap(variants)
      .some((holder) => holder instanceof core.$ZodArray || holder instanceof core.$ZodTuple)
  )
}

/**
 * Whether an update path names an element of an array or a tuple, or a path inside one, which
 * `$rename` neither moves nor writes, as MongoDB does (code 2).
 */
export function inElement(schema: core.$ZodType, path: string): boolean {
  const segments = path.split('.')

  return segments.some((_, index) => namesElement(schema, segments.slice(0, index + 1).join('.')))
}
