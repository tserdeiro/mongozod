import type { NotAPath, SchemaAt } from '../schema/schema-at'
import type { Comparable, Element, ElementSchema, Has, IsArray } from '../types/filter'
import type { Leaf } from '../types/loose'
import type { PathSuggestions } from '../types/path-suggestions'
import type * as core from 'zod/v4/core'

import { z } from 'zod'

import { schemaAt } from '../schema/schema-at'
import { elementsOf } from '../schema/schema-kinds'

import { nonEmptyObject } from './internal/non-empty-object'
import { valueSchema } from './internal/value-schema'
import { withoutUndefined } from './internal/without-undefined'

/** The operators a field of a client filter can declare. */
export type FilterOperator =
  | '$all'
  | '$elemMatch'
  | '$eq'
  | '$exists'
  | '$gt'
  | '$gte'
  | '$in'
  | '$lt'
  | '$lte'
  | '$ne'
  | '$nin'
  | '$regex'
  | '$size'

/** The operators that compare one element, inside the `$elemMatch` of an array of values. */
type ElementOperator = '$eq' | '$gt' | '$gte' | '$in' | '$lt' | '$lte' | '$ne' | '$nin' | '$regex'

type RangeOperator = '$gt' | '$gte' | '$lt' | '$lte'

type ArrayOperator = '$all' | '$elemMatch' | '$size'

/** Which side of an input a type describes: what the client sends, or what the router receives. */
export type Side = 'input' | 'output'

/** A value of a schema on one side, without `undefined`, which is never a value. */
export type ValueOf<T, D extends Side> = Exclude<
  D extends 'input' ? core.input<T> : core.output<T>,
  undefined
>

/** An equality matches the value of the field or, in an array, one element. */
type Equal<V> = V | Element<NonNullable<V>>

/** The operators that apply to a field. */
type Applicable<T, V = core.output<T>> =
  | '$eq'
  | '$exists'
  | '$in'
  | '$ne'
  | '$nin'
  | ([Comparable<V>] extends [never] ? never : RangeOperator)
  | (Has<V, string> extends true ? '$regex' : never)
  | (IsArray<V> extends true ? ArrayOperator : never)

type OperatorMessage<Op> = Op extends RangeOperator
  ? `"${Op}" compares numbers, strings, dates and ids`
  : Op extends '$regex'
    ? '"$regex" only applies to strings'
    : Op extends ArrayOperator
      ? `"${Op}" only applies to arrays`
      : `"${Op & string}" is not an operator of mz.filter`

/** The declarations under an array, relative to its elements, which `$elemMatch` takes. */
type Under<F, K extends string> = {
  [P in keyof F as P extends `${K}.${infer Rest}` ? Rest : never]: F[P]
}

type ElemMatchCheck<F, K extends string, T, L> =
  core.output<ElementSchema<T>> extends Leaf
    ? [Extract<L, ElementOperator>] extends [never]
      ? `"$elemMatch" on "${K}" needs operators for its elements, such as "$gte"`
      : '$elemMatch'
    : [keyof Under<F, K>] extends [never]
      ? `"$elemMatch" on "${K}" needs paths declared under it, such as "${K}.<field>"`
      : '$elemMatch'

/**
 * Each declared operator, or why it does not apply. A list without `$elemMatch` whose operators all
 * apply is returned as it is, which is what mapping it would give, without checking each operator
 * again while the declarations are inferred.
 */
type OperatorsCheck<F, K extends string, T, L extends ReadonlyArray<unknown>> =
  L extends ReadonlyArray<Exclude<Applicable<T>, '$elemMatch'>>
    ? L
    : {
        [I in keyof L]: L[I] extends Applicable<T>
          ? L[I] extends '$elemMatch'
            ? ElemMatchCheck<F, K, T, L[number]>
            : L[I]
          : OperatorMessage<L[I]>
      }

/**
 * Checks the declarations of `mz.filter`: each key is a path of the document, and each operator
 * applies to its field.
 */
export type FilterFieldsCheck<S, F> = {
  [K in keyof F]: K extends string
    ? string extends K
      ? 'a filter key must be a literal path'
      : [SchemaAt<S, K, 'filter'>] extends [never]
        ? NotAPath<K>
        : F[K] extends ReadonlyArray<unknown>
          ? OperatorsCheck<F, K, SchemaAt<S, K, 'filter'>, F[K]>
          : 'takes a list of operators'
    : never
}

/**
 * The paths the editor suggests in `mz.filter`, each with the operators that apply to it. A path
 * that `F` declares keeps its own list, which `FilterFieldsCheck` checks: intersected with another
 * array type, the compiler would compare every method of both.
 */
export type SuggestedFilterFields<S, F> = {
  [K in PathSuggestions<S, 'filter'>]?: F extends {
    [P in K]: infer L extends readonly [unknown, ...unknown[]]
  }
    ? L
    : ReadonlyArray<Applicable<SchemaAt<S, K, 'filter'>>>
}

type DeclaredOperators<L> = L extends ReadonlyArray<infer O> ? O : never

type OperatorValue<T, Op, Ops, Sub, D extends Side, V = ValueOf<T, D>> = Op extends '$eq' | '$ne'
  ? Equal<V>
  : Op extends '$in' | '$nin'
    ? Array<Equal<V>>
    : Op extends RangeOperator
      ? Comparable<V>
      : Op extends '$exists'
        ? boolean
        : Op extends '$options' | '$regex'
          ? string
          : Op extends '$all'
            ? Array<Element<NonNullable<V>>>
            : Op extends '$size'
              ? number
              : Op extends '$elemMatch'
                ? core.output<ElementSchema<T>> extends Leaf
                  ? Operators<ElementSchema<T>, Extract<Ops, ElementOperator>, Sub, D>
                  : FilterShape<ElementSchema<T>, Sub, D>
                : never

/** An object of the declared operators. `$options` goes with `$regex`. */
type Operators<T, Ops, Sub, D extends Side> = {
  [Op in (Ops & string) | ('$regex' extends Ops ? '$options' : never)]?: OperatorValue<
    T,
    Op,
    Ops,
    Sub,
    D
  >
}

/** A condition on one field: a value, when it declares `$eq`, or an object of operators. */
type Condition<T, Ops, Sub, D extends Side> =
  | ('$eq' extends Ops ? Equal<ValueOf<T, D>> : never)
  | Operators<T, Ops, Sub, D>

/**
 * A filter with the declared fields, on one side. Only `$elemMatch` reads the declarations under a
 * field, so the others skip them.
 */
export type FilterShape<S, F, D extends Side> = {
  [K in keyof F & string]?: Condition<
    SchemaAt<S, K, 'filter'>,
    DeclaredOperators<F[K]>,
    '$elemMatch' extends DeclaredOperators<F[K]> ? Under<F, K> : never,
    D
  >
}

/** The schema `mz.filter` returns: a strict object with each declared field optional. */
export type FilterSchema<S, F> = z.ZodObject<
  {
    [K in keyof F & string]: z.ZodOptional<
      z.ZodType<FilterShape<S, F, 'output'>[K], FilterShape<S, F, 'input'>[K]>
    >
  },
  z.core.$strict
>

const OPERATORS = new Set<string>([
  '$all',
  '$elemMatch',
  '$eq',
  '$exists',
  '$gt',
  '$gte',
  '$in',
  '$lt',
  '$lte',
  '$ne',
  '$nin',
  '$regex',
  '$size'
])

const ELEMENT_OPERATORS = new Set<string>([
  '$eq',
  '$gt',
  '$gte',
  '$in',
  '$lt',
  '$lte',
  '$ne',
  '$nin',
  '$regex'
])

type Declarations = ReadonlyArray<readonly [path: string, operators: readonly string[]]>

/**
 * The object of the declared operators, for a value and, in an array, its element. `{}` would be an
 * equality with an empty object, so it takes at least one operator.
 */
function operatorsSchema(
  value: core.$ZodType,
  element: core.$ZodType | undefined,
  path: string,
  operators: readonly string[],
  under: Declarations
): core.$ZodType {
  const equal = element ? z.union([value, element]) : value
  const shape: Record<string, core.$ZodType> = {}

  for (const operator of operators) {
    if (!OPERATORS.has(operator)) {
      throw new Error(`mz.filter: "${operator}" is not an operator of mz.filter`)
    }

    if ((operator === '$all' || operator === '$elemMatch' || operator === '$size') && !element) {
      throw new Error(`mz.filter: "${operator}" only applies to arrays, and "${path}" is not one`)
    }

    switch (operator) {
      case '$eq':
      case '$ne':
        shape[operator] = equal
        break
      case '$in':
      case '$nin':
        shape[operator] = z.array(equal)
        break
      case '$exists':
        shape[operator] = z.boolean()
        break
      case '$regex':
        shape.$regex = z.string()
        shape.$options = z.string()
        break
      case '$all':
        shape[operator] = z.array(element ?? value)
        break
      case '$size':
        shape[operator] = z.number().int().nonnegative()
        break
      case '$elemMatch':
        shape[operator] = elemMatchSchema(element ?? value, path, operators, under)
        break
      default:
        // `$gt`, `$gte`, `$lt` and `$lte` compare the value or, in an array, each element.
        shape[operator] = element ?? value
    }
  }

  // MongoDB rejects an `$options` without `$regex` with the code 2.
  return nonEmptyObject(shape, 'takes at least one operator').refine(
    (condition) => !('$options' in condition) || '$regex' in condition,
    { message: '"$options" needs "$regex"', path: ['$options'] }
  )
}

/**
 * The `$elemMatch` of an array: a filter on its elements with the paths declared under it, or the
 * operators declared for the field when its elements are values.
 */
function elemMatchSchema(
  element: core.$ZodType,
  path: string,
  operators: readonly string[],
  under: Declarations
): core.$ZodType {
  if (under.length > 0) {
    return nonEmptyObject(shapeOf(element, under), 'takes at least one condition')
  }

  const elementOperators = operators.filter((operator) => ELEMENT_OPERATORS.has(operator))

  if (elementOperators.length === 0) {
    throw new Error(
      `mz.filter: "$elemMatch" on "${path}" needs operators for its elements, or paths declared under it`
    )
  }

  return operatorsSchema(element, undefined, path, elementOperators, [])
}

/** The condition on one path: an object of operators, or also a value when it declares `$eq`. */
function conditionSchema(
  schema: core.$ZodType,
  path: string,
  operators: readonly string[],
  under: Declarations
): core.$ZodType {
  const targets = schemaAt(schema, path, 'filter')

  if (targets.length === 0) throw new Error(`mz.filter: "${path}" is not a path of the document`)

  const value = valueSchema(targets)
  const elements = targets.map(elementsOf)
  const element = elements.every(Boolean)
    ? valueSchema(elements.flatMap((each) => each ?? []))
    : undefined
  const equal = element ? z.union([value, element]) : value
  const object = operatorsSchema(value, element, path, operators, under)

  if (!operators.includes('$eq')) return object

  // The object of operators goes first: an object value would strip its `$` keys otherwise.
  return z.union([object, equal])
}

/** The declarations under a path, relative to it. */
function declarationsUnder(declarations: Declarations, path: string): Declarations {
  const under: Array<[string, readonly string[]]> = []

  for (const [other, operators] of declarations) {
    if (other.startsWith(`${path}.`)) under.push([other.slice(path.length + 1), operators])
  }

  return under
}

function shapeOf(schema: core.$ZodType, declarations: Declarations) {
  return Object.fromEntries(
    declarations.map(([path, operators]) => [
      path,
      conditionSchema(schema, path, operators, declarationsUnder(declarations, path))
    ])
  )
}

/**
 * The filter a client can send: MongoDB syntax with the operators each field declares. Anything
 * else fails, such as `$where`, `$expr`, a field or an operator not declared, or a value its field
 * does not take. Each value is parsed with the schema of its field, without its default, so an ISO
 * date becomes a `Date`; `undefined` keys are dropped.
 *
 * It returns a strict `z.object`, so the project decides with Zod what happens when the client
 * sends nothing: `.default({})` for a list, `.required({ _id: true })` for a filter by id, or
 * `.refine()` for at least one field. `$and`, `$or` and `$nor` are added with `.extend()`.
 *
 * @example
 *   filter: mz.filter(brandSchema, { _id: ['$eq', '$in'], name: ['$eq', '$exists'] }).default({})
 */
export function filter<S extends core.$ZodType, const F extends FilterFieldsCheck<S, F>>(
  schema: S,
  fields: F & SuggestedFilterFields<S, F>
): FilterSchema<S, F>

export function filter(
  schema: core.$ZodType,
  fields: Readonly<Record<string, readonly string[]>>
): z.ZodType {
  const shape = shapeOf(schema, Object.entries(fields))

  return z
    .strictObject(
      Object.fromEntries(
        Object.entries(shape).map(([path, condition]) => [path, z.optional(condition)])
      )
    )
    .overwrite(withoutUndefined)
}
