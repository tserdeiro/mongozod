import type { SchemaAt } from '../schema/schema-at'
import type { PathSuggestions } from '../types/path-suggestions'
import type { Side, ValueOf } from './filter'
import type { ElementPath, OutsideArraysProblem } from './internal/outside-arrays'
import type * as core from 'zod/v4/core'

import { z } from 'zod'

import { isDynamicKey } from '../schema/schema-at'
import { isDecimal, isInteger, isNumber, isOptional } from '../schema/schema-kinds'
import { withoutChecks } from '../schema/without-checks'

import { nonEmptyObject } from './internal/non-empty-object'
import { schemasOutsideArrays } from './internal/outside-arrays'
import { valueSchema } from './internal/value-schema'
import { withoutUndefined } from './internal/without-undefined'

/** The operators `mz.update` takes. */
export type UpdateOperator = '$inc' | '$set' | '$unset'

type IsOptional<T> = undefined extends core.output<T> ? true : false

/** A number, or a `Decimal128`, known by its `_bsontype`: `$inc` applies to both. */
type IsNumber<T> =
  NonNullable<core.output<T>> extends bigint | number | { _bsontype: 'Decimal128' } ? true : false

type IsDecimal<T> = NonNullable<core.output<T>> extends { _bsontype: 'Decimal128' } ? true : false

type UpdatePathCheck<S, Op, P> = P extends string
  ? P extends '_id' | `_id.${string}`
    ? 'the _id is immutable'
    : [OutsideArraysProblem<S, P, 'mz.update'>] extends [never]
      ? Op extends '$unset'
        ? IsOptional<SchemaAt<S, P, 'update'>> extends true
          ? P
          : `"${P}" is required, so it cannot be unset`
        : Op extends '$inc'
          ? IsNumber<SchemaAt<S, P, 'update'>> extends true
            ? P
            : `"${P}" is not a number`
          : P
      : OutsideArraysProblem<S, P, 'mz.update'>
  : never

/**
 * The paths an operator takes: the suggested ones, which `UpdatePathCheck` accepts, but those that
 * name an element, as a field whose key is a number.
 */
type AcceptedPath<S, Op> = Exclude<
  Op extends '$inc'
    ? PathsWhere<S, 'number'>
    : Op extends '$unset'
      ? PathsWhere<S, 'optional'>
      : UpdatePath<S>,
  ElementPath
>

/**
 * Each declared path, or why the operator does not take it. A list of accepted paths is returned as
 * it is, which is what mapping it would give, without checking each path again while the
 * declarations are inferred.
 */
type PathsCheck<S, Op, L extends ReadonlyArray<unknown>> =
  L extends ReadonlyArray<AcceptedPath<S, Op>>
    ? L
    : { [I in keyof L]: UpdatePathCheck<S, Op, L[I]> }

/**
 * Checks the declarations of `mz.update`: each operator is `$set`, `$unset` or `$inc`, and each of
 * its paths is a field it applies to, outside arrays.
 */
export type UpdateFieldsCheck<S, U> = {
  [Op in keyof U]: Op extends UpdateOperator
    ? U[Op] extends ReadonlyArray<unknown>
      ? PathsCheck<S, Op, U[Op]>
      : 'takes a list of paths'
    : `"${Op & string}" is not an operator of mz.update: use $set, $unset or $inc`
}

type UpdatePath<S> = Exclude<
  PathSuggestions<S, 'update'>,
  `$${string}` | `${string}.$${string}` | '_id' | `_id.${string}`
>

type PathsWhere<S, Is extends 'number' | 'optional'> = {
  [P in UpdatePath<S>]: (
    Is extends 'number' ? IsNumber<SchemaAt<S, P, 'update'>> : IsOptional<SchemaAt<S, P, 'update'>>
  ) extends true
    ? P
    : never
}[UpdatePath<S>]

/**
 * The list `U` declares under an operator when every path in it is suggested, or the suggested
 * one, which rejects the rest: intersected with another array type, the compiler would compare
 * every method of both.
 */
type DeclaredOr<U, Op extends UpdateOperator, Suggested> = U extends {
  [K in Op]: infer L extends Suggested
}
  ? L
  : Suggested

/** The paths the editor suggests under each operator of `mz.update`. */
export interface SuggestedUpdateFields<S, U> {
  $inc?: DeclaredOr<U, '$inc', ReadonlyArray<PathsWhere<S, 'number'>>>
  $set?: DeclaredOr<U, '$set', ReadonlyArray<UpdatePath<S>>>
  $unset?: DeclaredOr<U, '$unset', ReadonlyArray<PathsWhere<S, 'optional'>>>
}

type UpdateValue<T, Op, D extends Side> = Op extends '$set'
  ? ValueOf<T, D>
  : Op extends '$unset'
    ? '' | 1 | true
    : IsDecimal<T> extends true
      ? NonNullable<ValueOf<T, D>>
      : number

type Paths<L> = L extends ReadonlyArray<infer P> ? P & string : never

/** An update with the declared operators and paths, on one side. */
export type UpdateShape<S, U, D extends Side> = {
  [Op in keyof U & UpdateOperator]?: {
    [P in Paths<U[Op]>]?: UpdateValue<SchemaAt<S, P, 'update'>, Op, D>
  }
}

function valueOf(schema: core.$ZodType, operator: string, path: string): core.$ZodType {
  if (path === '_id' || path.startsWith('_id.')) throw new Error('mz.update: the _id is immutable')

  const targets = schemasOutsideArrays(schema, path, 'mz.update')

  switch (operator) {
    case '$set':
      return valueSchema(targets)

    case '$unset':
      // A key of a record or a catchall may be missing, as the model's updates take it.
      if (!targets.every(isOptional) && !isDynamicKey(schema, path)) {
        throw new Error(`mz.update: "${path}" is required, so it cannot be unset`)
      }

      return z.literal(['', 1, true])

    case '$inc':
      // A Decimal128 takes a decimal, such as the string of an amount, without the checks of the
      // field: they apply to the value, not to what changes it.
      if (targets.every(isDecimal)) return valueSchema(targets.map(withoutChecks))
      if (!targets.every(isNumber)) throw new Error(`mz.update: "${path}" is not a number`)

      return targets.some(isInteger) ? z.number().int() : z.number()

    default:
      throw new Error(
        `mz.update: "${operator}" is not an operator of mz.update: use $set, $unset or $inc`
      )
  }
}

/**
 * The update a client can send: MongoDB syntax with `$set`, `$unset` and `$inc` on the paths each
 * one declares, outside arrays. Values are parsed with the schema of their field, refinements
 * included, and a default is never filled in: an update of one field does not reset the others.
 * `$unset` only takes optional fields, and `$inc` numbers or a `Decimal128`, which takes what its
 * schema parses, such as the string of an amount. An update without operators fails, as
 * in the driver; `undefined` keys are dropped. The fields of `timestamps` are not declared: the
 * model sets them, and its update rejects them.
 *
 * @example
 *   update: mz.update(noteSchema, {
 *     $set: ['title', 'content'],
 *     $unset: ['color'],
 *     $inc: ['views']
 *   })
 *
 * @see https://mongozod.dev/docs/api/mzod#mzupdate
 */
export function update<S extends core.$ZodType, const U extends UpdateFieldsCheck<S, U>>(
  schema: S,
  operators: U & SuggestedUpdateFields<S, U>
): z.ZodType<UpdateShape<S, U, 'output'>, UpdateShape<S, U, 'input'>>

export function update(
  schema: core.$ZodType,
  operators: Readonly<Record<string, readonly string[]>>
): z.ZodType {
  return nonEmptyObject(
    Object.fromEntries(
      Object.entries(operators).map(([operator, paths]) => [
        operator,
        z
          .strictObject(
            Object.fromEntries(
              paths.map((path) => [path, z.optional(valueOf(schema, operator, path))])
            )
          )
          .overwrite(withoutUndefined)
      ])
    ),
    'an update takes at least one operator'
  )
}
