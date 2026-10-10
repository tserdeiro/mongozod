import type { Document } from 'mongodb'
import type * as core from 'zod/v4/core'

import { z } from 'zod'

import { documentTypes } from './document-types'
import { isPlainObject } from './is-plain-object'
import { schemaAt } from './schema-at'

/**
 * The `timestamps` option of `mongozod()`: `true` for `createdAt` and `updatedAt`, or an object
 * that renames each field or turns it off with `false`.
 */
export type TimestampsOption =
  | boolean
  | { createdAt?: boolean | string; updatedAt?: boolean | string }

type FieldName<T, K extends 'createdAt' | 'updatedAt'> = T extends true
  ? K
  : T extends { [P in K]?: infer V }
    ? V extends false
      ? never
      : V extends string
        ? V
        : K
    : never

/** The fields `timestamps` writes, by role: `never` for one that is off. */
export interface TimestampNames {
  createdAt: string
  updatedAt: string
}

/** The fields of a `timestamps` option. */
export interface TimestampNamesOf<T> {
  createdAt: FieldName<T, 'createdAt'>
  updatedAt: FieldName<T, 'updatedAt'>
}

/** No timestamps: the model's default. */
export interface NoTimestamps {
  createdAt: never
  updatedAt: never
}

type Problem<S, F extends string> =
  core.output<S> extends infer O
    ? O extends unknown
      ? F extends keyof O
        ? NonNullable<O[F]> extends Date
          ? never
          : `timestamps writes a Date in "${F}": the field must take and return one`
        : `timestamps needs the field "${F}" in the schema`
      : never
    : never

type InputProblem<S, F extends string> =
  core.input<S> extends infer I
    ? I extends unknown
      ? F extends keyof I
        ? Date extends I[F]
          ? undefined extends I[F]
            ? never
            : `timestamps fills "${F}": give it a .default() or make it optional`
          : `timestamps writes a Date in "${F}": the field must take and return one`
        : never
      : never
    : never

type Problems<S, N extends TimestampNames> =
  | Problem<S, N['createdAt']>
  | Problem<S, N['updatedAt']>
  | InputProblem<S, N['createdAt']>
  | InputProblem<S, N['updatedAt']>

/**
 * Checks that the schema declares the fields `timestamps` writes, in every type of document, taking
 * and returning a `Date` and with a `.default()` or optional. A problem becomes a property the
 * options lack, so the error shows it.
 */
export type TimestampsCheck<S, T> = [Problems<S, TimestampNamesOf<T>>] extends [never]
  ? unknown
  : { [P in Problems<S, TimestampNamesOf<T>>]: never }

/** The fields an update cannot write while `timestamps` is on: `$setOnInsert` can give `createdAt`. */
export type LockedFields<N extends TimestampNames, Op, O> = O extends { timestamps: false }
  ? never
  : N['updatedAt'] | (Op extends '$setOnInsert' ? never : N['createdAt'])

/** The per-operation `timestamps: false`, on the models that have timestamps. */
export type TimestampsOperationOption<N extends TimestampNames> = [
  N['createdAt'] | N['updatedAt']
] extends [never]
  ? unknown
  : { timestamps?: false }

/** The fields of a `timestamps` option at runtime, `undefined` for one that is off. */
export interface Timestamps {
  createdAt?: string
  updatedAt?: string
}

function nameOf(option: TimestampsOption | undefined, role: 'createdAt' | 'updatedAt') {
  if (option === true) return role
  if (!option) return undefined

  const value = option[role]

  if (value === false) return undefined

  return typeof value === 'string' ? value : role
}

/**
 * The fields a `timestamps` option writes. Throws an `Error` when the schema does not declare one
 * of them in every type of document, or it does not take a `Date`.
 */
export function timestampsOf(
  schema: core.$ZodType,
  option: TimestampsOption | undefined
): Timestamps {
  const timestamps = {
    createdAt: nameOf(option, 'createdAt'),
    updatedAt: nameOf(option, 'updatedAt')
  }

  const types = documentTypes(schema)

  for (const name of [timestamps.createdAt, timestamps.updatedAt]) {
    if (!name) continue

    const fields = schemaAt(schema, name, 'filter')
    const inEveryType = types.every((type) => schemaAt(type, name, 'filter').length > 0)

    if (!inEveryType || name.includes('.')) {
      throw new Error(`timestamps needs the field "${name}" in the schema`)
    }

    if (!fields.every((field) => z.safeParse(field, new Date()).success)) {
      throw new Error(`timestamps writes a Date in "${name}": the field must take one`)
    }
  }

  return timestamps
}

/**
 * Stamps a document to insert: `createdAt` keeps the one given or takes `now`, and `updatedAt`
 * keeps the one given or takes the value of `createdAt`.
 */
export function stampDocument(document: Document, timestamps: Timestamps, now: Date): Document {
  const stamped = { ...document }
  const { createdAt, updatedAt } = timestamps

  if (createdAt) stamped[createdAt] ??= now
  if (updatedAt) stamped[updatedAt] ??= createdAt ? stamped[createdAt] : now

  return stamped
}

/**
 * Stamps an update: `updatedAt` in `$set` and, in an upsert, `createdAt` in `$setOnInsert`, unless
 * it gives its own. Throws a `ZodError` when the update writes a field that `timestamps` sets.
 */
export function stampUpdate(
  update: unknown,
  timestamps: Timestamps,
  now: Date,
  upsert: unknown
): unknown {
  // An update that is not an object is rejected after, by `parseUpdate`.
  if (!isPlainObject(update)) return update

  const { createdAt, updatedAt } = timestamps
  const issues: core.$ZodIssue[] = []

  for (const [operator, fields] of Object.entries(update)) {
    if (!isPlainObject(fields)) continue

    for (const path of Object.keys(fields)) {
      const locked = path === updatedAt || (path === createdAt && operator !== '$setOnInsert')

      if (locked) {
        issues.push({
          code: 'custom',
          input: fields[path],
          message: `"${path}" is set by timestamps: pass timestamps: false to write it`,
          path: [operator, path]
        })
      }
    }
  }

  if (issues.length > 0) throw new z.ZodRealError(issues)

  const stamped: Document = { ...update }

  if (updatedAt) stamped.$set = { ...stamped.$set, [updatedAt]: now }
  if (upsert && createdAt) stamped.$setOnInsert = { [createdAt]: now, ...stamped.$setOnInsert }

  return stamped
}
