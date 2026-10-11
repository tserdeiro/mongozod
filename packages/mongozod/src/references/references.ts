import type { ModelSchema, None, Output, ReadDocument } from '../model/model'
import type { FieldsOf } from '../schema/document-types'
import type { FieldAt, SchemaAt } from '../schema/schema-at'
import type { FilterCheck, SuggestedFilter } from '../types/filter'
import type { Leaf } from '../types/loose'
import type { PathSuggestions } from '../types/path-suggestions'
import type {
  Entries,
  IsLiteral,
  Mode,
  ProjectionCheck,
  SuggestedProjection
} from '../types/projection'
import type { SortCheck, SuggestedSort } from '../types/sort'
import type { NotAString, Simplify } from '../utils/type-helpers'
import type { Virtuals } from './virtuals'
import type { ClientSession, Db, Document, FindOptions, Flatten, WithId } from 'mongodb'

import { BSON } from 'mongodb'
import { z } from 'zod'
import * as core from 'zod/v4/core'

import { documentTypes } from '../schema/document-types'
import { schemaAt } from '../schema/schema-at'
import { variants } from '../schema/schema-kinds'
import { isPlainObject } from '../utils/is-plain-object'

/**
 * What the types of `populate` use of a referenced model: its schema, its virtuals and its
 * references. Its `find` would make two models that reference each other circular types.
 */
export interface ReferencedModel {
  readonly references: object
  readonly schema: ModelSchema
  readonly virtuals: Virtuals
}

/** The `find` of each model, which `populate` reads the referenced documents with. */
const finders = new WeakMap<
  ReferencedModel,
  (filter: Document, options: Document) => PromiseLike<Document[]>
>()

/** Registers the `find` of a model, so that `populate` goes through it. */
export function registerFind(
  model: ReferencedModel,
  find: (filter: Document, options: Document) => PromiseLike<Document[]>
): void {
  finders.set(model, find)
}

/**
 * A one-to-many reference: the documents of another model whose `foreignField` stores the
 * `localField` of this document, `_id` by default, with the names of MongoDB's `$lookup`. It is not
 * stored, so its key is not a field of the schema, and `populate` gives an array.
 */
export interface ForeignReference {
  foreignField: string
  localField?: string
  model: () => ReferencedModel
}

/**
 * A reference stored in another field: the document of another model whose `_id` the `localField`
 * of this document stores, as `capital` from `capitalId`. It is not stored, so its key is not a
 * field of the schema, and `populate` gives what the `localField` stores: a document, or an array
 * when it stores an array.
 */
export interface LocalReference {
  localField: string
  model: () => ReferencedModel
}

/**
 * What a reference points to: a function that returns another model, so that its plugins and
 * virtuals apply, a collection and its schema, for one without a model, the document whose `_id`
 * another field stores, or the documents of another model that point to this one.
 */
export type ReferenceTarget =
  | (() => ReferencedModel)
  | { collection: string; schema: ModelSchema }
  | LocalReference
  | ForeignReference

/** The paths a reference can have: the fields of every type of document, and the paths under them. */
type ReferencePath<S extends ModelSchema> = FieldsOf<Output<S>> | PathSuggestions<S, 'filter'>

/**
 * The `references` of a model: the fields that store the `_id` of another document, or an array of
 * them, in one or more types of document, also inside objects and arrays of objects, such as
 * `items.product`, and the references stored in another field or one-to-many, whose keys are not
 * fields. Each target is a
 * `ReferenceTarget`, which `populate` checks: checking it here makes models that reference each
 * other, or themselves, circular types.
 */
export type References<S extends ModelSchema> = {
  [K in ReferencePath<S>]?: unknown
} & Record<string, unknown>

type ReferenceProblem<S extends ModelSchema, K, T> = T extends { foreignField: unknown }
  ? K extends ReferencePath<S>
    ? `"${K & string}" is a field of the schema: a reference with foreignField is not stored`
    : K extends `${string}.${string}`
      ? `"${K & string}" is a path: a reference with foreignField is a key of the document`
      : never
  : T extends { localField: unknown; model: unknown }
    ? K extends ReferencePath<S>
      ? `"${K & string}" is a field of the schema: a reference with localField is not stored`
      : K extends `${string}.${string}`
        ? `"${K & string}" is a path: a reference with localField is a key of the document`
        : never
    : K extends ReferencePath<S>
      ? never
      : `"${K & string}" is not a path of the schema`

/**
 * The keys of `references` that do not fit: a path that is not in the schema, or a one-to-many
 * reference that is a field or a path.
 */
export type UnknownReferences<S extends ModelSchema, R> = {
  [K in keyof R as [ReferenceProblem<S, K, R[K]>] extends [never] ? never : K]: ReferenceProblem<
    S,
    K,
    R[K]
  >
}

/** The keys of the one-to-many references, which reads add to the documents. */
type ForeignKeys<R> = {
  [K in keyof R]: R[K] extends { foreignField: unknown } ? K : never
}[keyof R]

/** The references stored in another field, which reads add to the documents. */
type LocalKeys<R> = {
  [K in keyof R]: R[K] extends { foreignField: unknown }
    ? never
    : R[K] extends { localField: string; model: unknown }
      ? K
      : never
}[keyof R]

/** The target of a reference: the model of one with a `localField` or a `foreignField`. */
type TargetOf<T> = T extends { model: infer M } ? M : T

type TargetSchema<T> =
  TargetOf<T> extends () => { readonly schema: infer TS extends ModelSchema }
    ? TS
    : TargetOf<T> extends { schema: infer TS extends ModelSchema }
      ? TS
      : never

type TargetVirtuals<T> = TargetOf<T> extends () => { readonly virtuals: infer TV } ? TV : None

/** The references of a target model, which a nested `populate` takes; a collection has none. */
type TargetReferences<T> = TargetOf<T> extends () => { readonly references: infer TR } ? TR : None

/** The field of this document a one-to-many reference matches: `_id` unless it says another. */
type LocalField<T> = T extends { localField: infer L extends string } ? L : '_id'

/** The values a path stores, or the elements of an array of them. */
type ValuesAt<S, K extends string> = Flatten<
  Exclude<core.output<FieldAt<S, K, 'filter'>>, null | undefined>
>

type TargetDocument<T> = WithId<Output<TargetSchema<T>>>

/**
 * The ids a reference stores, in the types of document that have it: its values, or the elements of
 * an array of them.
 */
type FieldIds<S, K> = K extends string
  ? Flatten<Exclude<core.output<SchemaAt<S, K, 'filter'>>, null | undefined>>
  : never

/** Whether the projection leaves out a reference: it excludes the reference or an object above it. */
type ExcludedBy<P, K> = {
  [Q in keyof P & string]: [P[Q]] extends [0 | false]
    ? K extends Q | `${Q}.${string}`
      ? true
      : never
    : never
}[keyof P & string]

/**
 * What a reference stores, which decides whether it takes a `limit`: one id, an array of them, or
 * nothing, for a one-to-many reference.
 */
type Holds = 'array' | 'foreign' | 'one'

/** The `limit` of a populated reference: for arrays, and with a `sort` in a one-to-many one. */
type LimitCheck<H extends Holds, X> = H extends 'one'
  ? 'limit takes a reference that stores an array'
  : H extends 'foreign'
    ? X extends { sort: object }
      ? number
      : 'a limit needs a sort: without one, the documents it keeps are arbitrary'
    : number

/** The options of a populated reference, named like the driver's, checked like the target's. */
type PopulateOptionsCheck<T, X, H extends Holds> = {
  [K in keyof X]: K extends 'projection'
    ? ProjectionCheck<TargetSchema<T>, X[K], TargetVirtuals<T>>
    : K extends 'filter'
      ? FilterCheck<TargetSchema<T>, X[K]>
      : K extends 'sort'
        ? SortCheck<TargetSchema<T>, X[K]>
        : K extends 'populate'
          ? PopulateCheck<
              TargetSchema<T>,
              TargetReferences<T>,
              X[K],
              X extends { projection: infer P } ? P : None
            >
          : K extends 'limit'
            ? LimitCheck<H, X>
            : `"${K & string}" is not an option of populate: use projection, filter, sort, limit or populate`
}

type PopulateValueCheck<T, X, H extends Holds> = X extends true
  ? true
  : X extends object
    ? PopulateOptionsCheck<T, X, H>
    : 'populate takes true, or { projection, filter, sort, limit, populate }'

/**
 * Checks a `populate`: each key is a reference of the model, whose field stores the `_id` of its
 * target, and the projection of the read does not exclude it. Each value is `true`, for the whole
 * document, or the options of its query, named like the driver's: a `projection`, a `filter` that
 * leaves out the documents that do not match, a `sort` and a `limit` for the arrays of references,
 * per document, and the `populate` of the target model, checked against its references.
 */
export type PopulateCheck<S extends ModelSchema, R, Pop, P> = {
  [K in keyof Pop]: K extends keyof R
    ? [TargetSchema<R[K]>] extends [never]
      ? `"${K & string}" points to neither a function that returns a model nor { collection, schema }`
      : R[K] extends { foreignField: infer FF extends string }
        ? ForeignCheck<S, R[K], K, FF, LocalField<R[K]>, Pop[K], P>
        : R[K] extends { localField: infer L extends string }
          ? LocalCheck<S, R[K], K, L, Pop[K], P>
          : [FieldIds<S, K>] extends [TargetDocument<R[K]>['_id']]
            ? [ExcludedBy<P, K>] extends [never]
              ? PopulateValueCheck<
                  R[K],
                  Exclude<Pop[K], undefined>,
                  NonNullable<
                    core.output<SchemaAt<S, K & string, 'filter'>>
                  > extends ReadonlyArray<unknown>
                    ? 'array'
                    : 'one'
                >
              : `populate needs "${K & string}": the projection excludes it`
            : `"${K & string}" stores another type than the _id of its target`
    : `"${K & string}" is not a reference of the model`
}

/**
 * Whether the projection leaves out the `localField` of a one-to-many reference. An inclusion that
 * drops the `_id` still gets it: the read asks for it and removes it afterwards.
 */
type LocalExcludedBy<P, L> = L extends '_id'
  ? IsLiteral<P> extends true
    ? Mode<Entries<P>> extends 'inclusion'
      ? never
      : ExcludedBy<P, L>
    : ExcludedBy<P, L>
  : ExcludedBy<P, L>

/**
 * What a path stores in a document: its value, or, when it goes through an array, the values of
 * its elements in one array, as `populate` takes them at runtime.
 */
type StoredAt<T, P extends string> = T extends null | undefined
  ? undefined
  : T extends ReadonlyArray<infer E>
    ? Array<Flatten<Exclude<StoredAt<E, P>, null | undefined>>>
    : P extends `${infer Head}.${infer Rest}`
      ? Head extends keyof T
        ? StoredAt<T[Head], Rest>
        : undefined
      : P extends keyof T
        ? T[P]
        : undefined

/**
 * Checks a reference stored in another field: its `localField` is a path of this document that
 * stores the `_id` of the target, or an array of them, and the projection of the read keeps it.
 */
type LocalCheck<S extends ModelSchema, T, K, L extends string, X, P> = [
  FieldAt<S, L, 'filter'>
] extends [never]
  ? `"${K & string}": "${L}" is not a path of the document`
  : [ValuesAt<S, L>] extends [TargetDocument<T>['_id']]
    ? [ExcludedBy<P, L>] extends [never]
      ? PopulateValueCheck<
          T,
          Exclude<X, undefined>,
          NonNullable<StoredAt<Output<S>, L>> extends ReadonlyArray<unknown> ? 'array' : 'one'
        >
      : `populate needs "${L}" for "${K & string}": the projection excludes it`
    : `"${K & string}": "${L}" stores another type than the _id of its target`

/**
 * Checks a one-to-many reference: its `foreignField` is a path of the target and its `localField`
 * one of this document, both store the same type, and the projection of the read keeps the local
 * one.
 */
type ForeignCheck<S extends ModelSchema, T, K, FF extends string, L extends string, X, P> = [
  FieldAt<TargetSchema<T>, FF, 'filter'>
] extends [never]
  ? `"${K & string}": "${FF}" is not a path of its target`
  : [FieldAt<S, L, 'filter'>] extends [never]
    ? `"${K & string}": "${L}" is not a path of the document`
    : [ValuesAt<S, L>] extends [ValuesAt<TargetSchema<T>, FF>]
      ? [LocalExcludedBy<P, L>] extends [never]
        ? Exclude<X, undefined> extends { populate: infer NP }
          ? FF extends keyof NP
            ? `"${K & string}" cannot populate "${FF}", its foreignField: it points back to this document`
            : PopulateValueCheck<T, Exclude<X, undefined>, 'foreign'>
          : PopulateValueCheck<T, Exclude<X, undefined>, 'foreign'>
        : `populate needs "${L}" for "${K & string}": the projection excludes it`
      : `"${K & string}": "${FF}" stores another type than "${L}"`

/** The keys and options the editor suggests in a `populate`. */
export type SuggestedPopulate<R> = {
  [K in keyof R]?:
    | true
    | {
        filter?: SuggestedFilter<TargetSchema<R[K]>>
        limit?: number
        projection?: SuggestedProjection<TargetSchema<R[K]>, TargetVirtuals<R[K]>>
        populate?: SuggestedPopulate<TargetReferences<R[K]>>
        sort?: SuggestedSort<TargetSchema<R[K]>>
      }
}

/** The `populate` option, on the models that have references. */
export type PopulateOption<R, Pop> = [keyof R] extends [never]
  ? unknown
  : {
      populate?:
        | (Pop &
            SuggestedPopulate<R> &
            NotAString<Pop, 'populate takes an object such as { author: true }, not a string'>)
        | undefined
    }

/** Whether a path of the projection is the reference or an object above it. */
type IncludedBy<P, K> = {
  [Q in keyof P & string]: K extends Q | `${Q}.${string}` ? true : never
}[keyof P & string]

/**
 * The projection a read asks the server for: an inclusion also returns what it populates, unless it
 * already includes it or an object above it, which MongoDB would take as a path collision. A
 * one-to-many reference is not stored: the field it matches is asked for and removed afterwards.
 */
export type PopulatedProjection<P, Pop, R> = [keyof Pop] extends [never]
  ? P
  : IsLiteral<P> extends true
    ? Mode<Entries<P>> extends 'inclusion'
      ? P & {
          [
            K in keyof Pop as K extends ForeignKeys<R> | LocalKeys<R>
              ? never
              : [IncludedBy<P, K>] extends [never]
                ? K
                : never
          ]: 1
        }
      : P
    : P

/** A populated document, as its model reads it with the options of the `populate`. */
type ReadOf<T, X> = X extends unknown
  ? ReadDocument<
      TargetSchema<T>,
      TargetVirtuals<T>,
      TargetReferences<T>,
      X extends { projection: infer P } ? P : None,
      X extends { populate: infer Pop } ? Exclude<Pop, undefined> : None
    >
  : never

/** A populated field: the document, or `null` when it is missing; an array keeps the ones found. */
type PopulatedValue<F, T, X> =
  | (Exclude<F, null | undefined> extends ReadonlyArray<unknown>
      ? Array<ReadOf<T, X>>
      : ReadOf<T, X> | null)
  | Extract<F, null | undefined>

/**
 * One type of document with its references populated, at the paths under `Prefix`: through arrays
 * and objects, down to each reference. A reference that may not have been asked for, as in a
 * `populate` that arrives at runtime, may still be the id.
 */
type PopulatedLevel<T, R, Pop, Prefix extends string> =
  T extends ReadonlyArray<infer E>
    ? Array<PopulatedLevel<E, R, Pop, Prefix>>
    : T extends Leaf
      ? T
      : Simplify<{
          [K in keyof T]: K extends string
            ? `${Prefix}${K}` extends infer Path extends keyof Pop & keyof R
              ?
                  | PopulatedValue<T[K], R[Path], Exclude<Pop[Path], undefined>>
                  | (Pick<Pop, Path> extends Required<Pick<Pop, Path>> ? never : T[K])
              : [Extract<keyof Pop, `${Prefix}${K}.${string}`>] extends [never]
                ? T[K]
                : PopulatedLevel<T[K], R, Pop, `${Prefix}${K}.`>
            : T[K]
        }>

/**
 * The one-to-many references a read asks for: an array of documents each, which a `populate` that
 * arrives at runtime may not have asked for.
 */
type ForeignPopulated<R, Pop> = {
  [
    K in ForeignKeys<R> & keyof Pop as Pick<Pop, K> extends Required<Pick<Pop, K>> ? K : never
  ]: Array<ReadOf<R[K], Exclude<Pop[K], undefined>>>
} & {
  [
    K in ForeignKeys<R> & keyof Pop as Pick<Pop, K> extends Required<Pick<Pop, K>> ? never : K
  ]?: Array<ReadOf<R[K], Exclude<Pop[K], undefined>>>
}

/**
 * The references stored in another field a read asks for: what their `localField` stores in the
 * document `D`, populated, which a `populate` that arrives at runtime may not have asked for.
 */
type LocalPopulated<D, R, Pop> = {
  [
    K in LocalKeys<R> & keyof Pop as Pick<Pop, K> extends Required<Pick<Pop, K>> ? K : never
  ]: PopulatedValue<StoredAt<D, LocalField<R[K]>>, R[K], Exclude<Pop[K], undefined>>
} & {
  [
    K in LocalKeys<R> & keyof Pop as Pick<Pop, K> extends Required<Pick<Pop, K>> ? never : K
  ]?: PopulatedValue<StoredAt<D, LocalField<R[K]>>, R[K], Exclude<Pop[K], undefined>>
}

/**
 * The documents a read returns, with the references of its `populate` replaced, and those that
 * are not stored added. `D` is the document as stored, whose `localField`s the read asks for even
 * when the projection leaves them out.
 */
export type Populated<T, R, Pop, D = T> = [keyof Pop] extends [never]
  ? T
  : T extends unknown
    ? [(ForeignKeys<R> | LocalKeys<R>) & keyof Pop] extends [never]
      ? PopulatedLevel<T, R, Pop, ''>
      : Simplify<
          PopulatedLevel<T, R, Pop, ''> & ForeignPopulated<R, Pop> & LocalPopulated<D, R, Pop>
        >
    : never

/** Whether a reference is stored in another field: a `localField` without a `foreignField`. */
function isLocal(target: unknown): target is LocalReference {
  return (
    isPlainObject(target) &&
    target.foreignField === undefined &&
    typeof target.localField === 'string' &&
    typeof target.model === 'function'
  )
}

/** Whether a reference is a one-to-many one, with a `foreignField`. */
function isForeign(target: unknown): target is ForeignReference {
  return (
    isPlainObject(target) &&
    typeof target.foreignField === 'string' &&
    typeof target.model === 'function' &&
    (target.localField === undefined || typeof target.localField === 'string')
  )
}

/**
 * Checks each reference: a path of the schema, in one or more types of document, without array
 * indexes, that points to a function or to `{ collection, schema }`; or a one-to-many reference,
 * whose key is not a field and whose `localField` is. Throws an `Error` when one does not fit.
 */
export function checkReferences(schema: core.$ZodType, references: object = {}): void {
  const types = documentTypes(schema)
  const inSchema = (path: string) => types.some((type) => schemaAt(type, path, 'filter').length > 0)
  const isRecord = (path: string) =>
    types.some((type) =>
      schemaAt(type, path, 'filter').some((sub) =>
        variants(sub).some((variant) => variant instanceof core.$ZodRecord)
      )
    )

  // The keys of a record are not fields, so its types take no path through one, and a record
  // stores no ids: `populate` would leave them, or drop the record.
  const checkStored = (name: string, path: string) => {
    const segments = path.split('.')
    const record = segments
      .map((_, index) => segments.slice(0, index + 1).join('.'))
      .find((prefix) => isRecord(prefix))

    if (record === path)
      throw new Error(`references: "${name}" stores a record in "${path}", not ids`)
    if (record) {
      throw new Error(
        `references: "${name}" goes through "${record}", a record, whose keys are not fields`
      )
    }
  }

  for (const [name, target] of Object.entries(references)) {
    if (isLocal(target)) {
      if (name.includes('.') || inSchema(name)) {
        throw new Error(
          `references: "${name}" populates from its localField, so it is not stored: it is a key that is not a field`
        )
      }

      if (!inSchema(target.localField)) {
        throw new Error(
          `references: "${name}" needs its localField "${target.localField}" in the schema`
        )
      }

      checkStored(name, target.localField)
      continue
    }

    if (isForeign(target)) {
      if (name.includes('.') || inSchema(name)) {
        throw new Error(
          `references: "${name}" has a foreignField, so it is not stored: it is a key that is not a field`
        )
      }

      const localField = target.localField ?? '_id'

      if (localField !== '_id' && !inSchema(localField)) {
        throw new Error(`references: "${name}" needs its localField "${localField}" in the schema`)
      }

      checkStored(name, localField)

      continue
    }

    // `populate` goes through every element of an array, so an index would leave its ids untouched.
    if (name.split('.').some((segment) => /^\d+$/.test(segment))) {
      throw new Error(`references: "${name}" names an array index: a reference takes every element`)
    }

    if (!inSchema(name)) throw new Error(`references needs the field "${name}" in the schema`)

    checkStored(name, name)

    const isTarget =
      typeof target === 'function' ||
      (isPlainObject(target) &&
        typeof target.collection === 'string' &&
        target.schema instanceof core.$ZodType)

    if (!isTarget) {
      throw new Error(
        `references: "${name}" points to neither a function that returns a model, { collection, schema }, { model, localField } nor { model, foreignField }`
      )
    }
  }
}

/** The options of a populated reference, named like the driver's, and its nested `populate`. */
export interface PopulateOptions {
  filter?: Document
  limit?: number
  populate?: Document
  projection?: Document
  sort?: Document
}

/** A reference to populate: its field, its target and the options of its query. */
export type PopulateEntry = [field: string, target: ReferenceTarget, options: PopulateOptions]

/**
 * The stored path a reference reads: its field, or the `localField` of a one-to-many reference,
 * which a read's projection has to keep.
 */
export function storedPath([field, target]: PopulateEntry): string {
  if (isLocal(target)) return target.localField

  return isForeign(target) ? (target.localField ?? '_id') : field
}

const POPULATE_OPTIONS = new Set(['filter', 'limit', 'populate', 'projection', 'sort'])

/**
 * Validates a `populate` at runtime, like its types: each key is a reference of the model, and each
 * value is `true` or an object of options, each one an object. Throws a `ZodError` otherwise.
 */
export function populateEntries(
  populate: unknown,
  references: Record<string, ReferenceTarget>
): PopulateEntry[] {
  if (populate === undefined) return []

  if (!isPlainObject(populate)) {
    throw new z.ZodRealError([
      { code: 'custom', input: populate, message: 'populate is an object', path: ['populate'] }
    ])
  }

  const issues: core.$ZodIssue[] = []
  const entries: PopulateEntry[] = []

  for (const [field, value] of Object.entries(populate)) {
    if (value === undefined) continue

    const target = Object.hasOwn(references, field) ? references[field] : undefined

    if (!target) {
      issues.push({
        code: 'custom',
        input: value,
        message: `"${field}" is not a reference of the model`,
        path: ['populate', field]
      })
    } else if (
      isForeign(target) &&
      schemaAt(target.model().schema, target.foreignField, 'filter').length === 0
    ) {
      // Checked here and not when the model is defined, when the target may not exist yet.
      issues.push({
        code: 'custom',
        input: value,
        message: `"${field}": "${target.foreignField}" is not a path of its target`,
        path: ['populate', field]
      })
    } else if (value === true) {
      entries.push([field, target, {}])
    } else if (isPlainObject(value)) {
      const options: PopulateOptions = {}

      for (const [name, option] of Object.entries(value)) {
        if (option === undefined) continue

        if (!POPULATE_OPTIONS.has(name)) {
          issues.push({
            code: 'custom',
            input: option,
            message: `"${name}" is not an option of populate: use projection, filter, sort, limit or populate`,
            path: ['populate', field, name]
          })
        } else if (
          name === 'populate' &&
          isForeign(target) &&
          isPlainObject(option) &&
          Object.hasOwn(option, target.foreignField)
        ) {
          // Populating it would replace the values that map each document back.
          issues.push({
            code: 'custom',
            input: option,
            message: `"${field}" cannot populate "${target.foreignField}", its foreignField: it points back to this document`,
            path: ['populate', field, name, target.foreignField]
          })
        } else if (
          name === 'populate' &&
          !(typeof target === 'function' || isLocal(target) || isForeign(target))
        ) {
          issues.push({
            code: 'custom',
            input: option,
            message: `"${field}" points to a collection without a model, which has no references`,
            path: ['populate', field, name]
          })
        } else if (name === 'limit') {
          if (typeof option === 'number' && Number.isInteger(option) && option > 0) {
            options.limit = option
          } else {
            issues.push({
              code: 'custom',
              input: option,
              message: 'the limit of populate is a positive integer',
              path: ['populate', field, name]
            })
          }
        } else if (isPlainObject(option)) {
          if (name === 'filter') options.filter = option
          if (name === 'populate') options.populate = option
          if (name === 'projection') options.projection = option
          if (name === 'sort') options.sort = option
        } else {
          issues.push({
            code: 'custom',
            input: option,
            message: `the ${name} of populate is an object`,
            path: ['populate', field, name]
          })
        }
      }

      if (isForeign(target) && options.limit !== undefined && !options.sort) {
        issues.push({
          code: 'custom',
          input: options.limit,
          message: 'a limit needs a sort: without one, the documents it keeps are arbitrary',
          path: ['populate', field, 'limit']
        })
      }

      entries.push([field, target, options])
    } else {
      issues.push({
        code: 'custom',
        input: value,
        message: 'populate takes true, or { projection, filter, sort, limit, populate }',
        path: ['populate', field]
      })
    }
  }

  if (issues.length > 0) throw new z.ZodRealError(issues)

  return entries
}

/**
 * Calls `visit` with each object that holds the last segment of a path, going through the arrays on
 * the way, as MongoDB does with the paths of a filter.
 */
function eachHolder(
  value: unknown,
  segments: readonly string[],
  visit: (holder: Document, key: string) => void
): void {
  if (Array.isArray(value)) {
    for (const element of value) eachHolder(element, segments, visit)

    return
  }

  const [segment, ...rest] = segments

  if (!isPlainObject(value) || segment === undefined) return
  if (rest.length === 0) visit(value, segment)
  else eachHolder(value[segment], rest, visit)
}

/** An id as a key of a map: two ids are the same key when MongoDB finds one with the other. */
function idKey(id: unknown) {
  return BSON.EJSON.stringify(id)
}

/** Each id once, by its key: many documents of a batch may point to the same one. */
function distinctIds(ids: readonly unknown[]): unknown[] {
  return [...new Map(ids.map((id) => [idKey(id), id])).values()]
}

/**
 * What a path stores in a document: its value, or, when it goes through an array, the values of
 * its elements in one array, without the missing ones.
 */
function storedAt(value: unknown, segments: readonly string[]): unknown {
  if (Array.isArray(value)) {
    return value.flatMap((element) => storedAt(element, segments) ?? [])
  }

  const [segment, ...rest] = segments

  if (!isPlainObject(value) || segment === undefined) return undefined

  return rest.length === 0 ? value[segment] : storedAt(value[segment], rest)
}

/** The values a path holds in a document, through its arrays, with the elements of arrays of them. */
function valuesAt(document: unknown, path: string): unknown[] {
  const values: unknown[] = []

  eachHolder(document, path.split('.'), (holder, field) => values.push(holder[field] ?? []))

  return values.flat()
}

/** Removes a path from a document, through its arrays. */
export function removePath(document: unknown, path: string): void {
  eachHolder(document, path.split('.'), (holder, field) => {
    delete holder[field]
  })
}

/** The `find` of the model a reference returns, which `populate` reads with. */
function finderOf(model: () => ReferencedModel, key: string) {
  const find = finders.get(model())

  if (!find) throw new Error(`references: "${key}" does not return a model of mongozod`)

  return find
}

/**
 * The projection of a one-to-many query, which keeps the `foreignField` that maps each document
 * back, and whether to remove it afterwards because the projection leaves it out.
 */
function keepingField(projection: Document | undefined, path: string) {
  if (!projection) return { projection, strip: false }

  const value = projection[path]

  if (value === 0 || value === false) {
    const { [path]: _excluded, ...rest } = projection

    return { projection: rest, strip: true }
  }

  if (value !== undefined) return { projection, strip: false }

  const inclusion = Object.entries(projection).some(
    ([key, kind]) => key !== '_id' && (kind === 1 || kind === true)
  )

  return inclusion
    ? { projection: { ...projection, [path]: 1 }, strip: true }
    : { projection, strip: false }
}

/**
 * Adds to each document the documents of the target model whose `foreignField` stores one of the
 * values of its `localField`, with one `$in` query for the batch: an array in the order of the
 * query, empty when none match. With a `limit`, one query per document, in parallel, since a
 * query's limit counts the results of the whole batch.
 */
async function populateForeign(
  documents: readonly Document[],
  key: string,
  target: ForeignReference,
  { filter, limit, populate, projection, sort }: PopulateOptions,
  session: ClientSession | undefined
): Promise<void> {
  const localField = target.localField ?? '_id'
  const { foreignField } = target
  const kept = keepingField(projection, foreignField)
  const options: Document = {}
  const find = finderOf(target.model, key)

  if (kept.projection) options.projection = kept.projection
  if (session) options.session = session
  if (sort) options.sort = sort
  if (populate) options.populate = populate

  const query = (values: unknown[]) => {
    const condition = { [foreignField]: { $in: values } }

    return filter ? { $and: [condition, filter] } : condition
  }

  for (const document of documents) document[key] = []

  if (limit !== undefined) {
    const found = await Promise.all(
      documents.map(async (document) => {
        const values = distinctIds(valuesAt(document, localField))
        const own = values.length > 0 ? await find(query(values), { ...options, limit }) : []

        document[key] = own

        return own
      })
    )

    if (kept.strip) for (const document of found.flat()) removePath(document, foreignField)

    return
  }

  const values = distinctIds(documents.flatMap((document) => valuesAt(document, localField)))

  if (values.length === 0) return

  const found = await find(query(values), options)
  const byValue = new Map<string, Document[]>()

  for (const document of found) {
    for (const value of valuesAt(document, foreignField)) {
      byValue.set(idKey(value), [...(byValue.get(idKey(value)) ?? []), document])
    }
  }

  const position = new Map(found.map((document, index) => [document, index]))

  for (const document of documents) {
    const matched = new Set(
      valuesAt(document, localField).flatMap((value) => byValue.get(idKey(value)) ?? [])
    )

    document[key] = [...matched].toSorted((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0))
  }

  if (kept.strip) for (const document of found) removePath(document, foreignField)
}

/**
 * Replaces each reference of the documents with the document it points to, in place, with one `$in`
 * query per reference. A missing document, or one the `filter` leaves out, becomes `null`, and an
 * array keeps the ones found, in its order or in the one of `sort`. The queries share the session
 * of the read, so they see the writes of its transaction.
 */
export async function populateDocuments(
  documents: readonly Document[],
  entries: readonly PopulateEntry[],
  db: () => Db,
  session: ClientSession | undefined
): Promise<void> {
  await Promise.all(
    entries.map(([key, target, options]) => {
      if (isForeign(target)) return populateForeign(documents, key, target, options, session)

      if (isLocal(target)) {
        // It takes what the localField stores, and then populates it as a stored reference.
        for (const document of documents) {
          const stored = storedAt(document, target.localField.split('.'))

          if (stored !== undefined) document[key] = stored
        }

        return populateStored(documents, key, target.model, options, db, session)
      }

      return populateStored(documents, key, target, options, db, session)
    })
  )
}

/**
 * Replaces each reference stored at a path of the documents with the document it points to, in
 * place, with one `$in` query.
 */
async function populateStored(
  documents: readonly Document[],
  key: string,
  target: (() => ReferencedModel) | { collection: string; schema: ModelSchema },
  options: PopulateOptions,
  db: () => Db,
  session: ClientSession | undefined
): Promise<void> {
  const { filter, limit, populate, projection, sort } = options
  const segments = key.split('.')
  const stored: unknown[] = []

  eachHolder(documents, segments, (holder, field) => stored.push(holder[field] ?? []))

  const ids = distinctIds(stored.flat())

  if (ids.length === 0) return

  // The `_id` maps each document back to its reference: when the projection leaves it out, it
  // is asked for and removed afterwards.
  const { _id: idProjection, ...rest } = projection ?? {}
  const withoutId = idProjection === 0 || idProjection === false
  const findOptions: FindOptions = {}

  if (projection) findOptions.projection = withoutId ? rest : projection
  if (session) findOptions.session = session
  if (sort) findOptions.sort = sort

  // In `$and`, so that a `filter` on the `_id` narrows the references instead of replacing them.
  const query: Document = filter ? { $and: [{ _id: { $in: ids } }, filter] } : { _id: { $in: ids } }
  let found: Document[]

  if (typeof target === 'function') {
    // The target model populates its own references, which validates the nested `populate`.
    found = await finderOf(target, key)(
      query,
      populate ? { ...findOptions, populate } : findOptions
    )
  } else {
    found = await db().collection(target.collection).find(query, findOptions).toArray()
  }

  const byId = new Map(found.map((document) => [idKey(document._id), document]))

  if (withoutId) for (const document of found) delete document._id

  // With a `sort`, an array follows the order of the query, the one the server sorted.
  const position = new Map(found.map((document, index) => [document, index]))

  eachHolder(documents, segments, (holder, field) => {
    const value = holder[field]

    if (Array.isArray(value)) {
      const populated = value.flatMap((id) => byId.get(idKey(id)) ?? [])

      if (sort) populated.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0))

      // The limit of each array: the query brings every id, which the arrays already bound.
      holder[field] = limit === undefined ? populated : populated.slice(0, limit)
    } else if (value !== null && value !== undefined) {
      holder[field] = byId.get(idKey(value)) ?? null
    }
  })
}
