import type { FieldsOf } from './document-types'
import type { FilterCheck, SuggestedFilter } from './filter'
import type { Leaf } from './loose'
import type { ModelSchema, None, Output } from './model'
import type { PathSuggestions } from './path-suggestions'
import type { Entries, IsLiteral, Mode, ProjectionCheck, SuggestedProjection } from './projection'
import type { SchemaAt } from './schema-at'
import type { SortCheck, SuggestedSort } from './sort'
import type { Simplify } from './type-helpers'
import type { Read, Virtuals } from './virtuals'
import type { ClientSession, Db, Document, FindOptions, Flatten, WithId } from 'mongodb'

import { BSON } from 'mongodb'
import { z } from 'zod'
import * as core from 'zod/v4/core'

import { documentTypes } from './document-types'
import { isPlainObject } from './is-plain-object'
import { schemaAt } from './schema-at'

/**
 * What the types of `populate` use of a referenced model: its schema and its virtuals. Its `find`
 * would make two models that reference each other circular types.
 */
export interface ReferencedModel {
  readonly schema: ModelSchema
  readonly virtuals: Virtuals
}

/** The `find` of each model, which `populate` reads the referenced documents with. */
const finders = new WeakMap<
  ReferencedModel,
  (filter: Document, options: FindOptions) => PromiseLike<Document[]>
>()

/** Registers the `find` of a model, so that `populate` goes through it. */
export function registerFind(
  model: ReferencedModel,
  find: (filter: Document, options: FindOptions) => PromiseLike<Document[]>
): void {
  finders.set(model, find)
}

/**
 * What a reference points to: a function that returns another model, so that its plugins and
 * virtuals apply, or a collection and its schema, for one without a model.
 */
export type ReferenceTarget = (() => ReferencedModel) | { collection: string; schema: ModelSchema }

/** The paths a reference can have: the fields of every type of document, and the paths under them. */
type ReferencePath<S extends ModelSchema> = FieldsOf<Output<S>> | PathSuggestions<S, 'filter'>

/**
 * The `references` of a model: the fields that store the `_id` of another document, or an array of
 * them, in one or more types of document, also inside objects and arrays of objects, such as
 * `items.product`. Each target is a `ReferenceTarget`, which `populate` checks: checking it here
 * makes models that reference each other, or themselves, circular types.
 */
export type References<S extends ModelSchema> = {
  [K in ReferencePath<S>]?: unknown
}

/** The keys of `references` that are not paths of the schema. */
export type UnknownReferences<S extends ModelSchema, R> = {
  [K in Exclude<keyof R, ReferencePath<S>>]: `"${K & string}" is not a path of the schema`
}

type TargetSchema<T> = T extends () => { readonly schema: infer TS extends ModelSchema }
  ? TS
  : T extends { schema: infer TS extends ModelSchema }
    ? TS
    : never

type TargetVirtuals<T> = T extends () => { readonly virtuals: infer TV } ? TV : None

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

/** The options of a populated reference, named like the driver's, checked like the target's. */
type PopulateOptionsCheck<T, X> = {
  [K in keyof X]: K extends 'projection'
    ? ProjectionCheck<TargetSchema<T>, X[K], TargetVirtuals<T>>
    : K extends 'filter'
      ? FilterCheck<TargetSchema<T>, X[K]>
      : K extends 'sort'
        ? SortCheck<TargetSchema<T>, X[K]>
        : `"${K & string}" is not an option of populate: use projection, filter or sort`
}

type PopulateValueCheck<T, X> = X extends true
  ? true
  : X extends object
    ? PopulateOptionsCheck<T, X>
    : 'populate takes true, or { projection, filter, sort }'

/**
 * Checks a `populate`: each key is a reference of the model, whose field stores the `_id` of its
 * target, and the projection of the read does not exclude it. Each value is `true`, for the whole
 * document, or the options of its query, named like the driver's: a `projection`, a `filter` that
 * leaves out the documents that do not match, and a `sort` for the arrays of references.
 */
export type PopulateCheck<S extends ModelSchema, R, Pop, P> = {
  [K in keyof Pop]: K extends keyof R
    ? [TargetSchema<R[K]>] extends [never]
      ? `"${K & string}" points to neither a function that returns a model nor { collection, schema }`
      : [FieldIds<S, K>] extends [TargetDocument<R[K]>['_id']]
        ? [ExcludedBy<P, K>] extends [never]
          ? PopulateValueCheck<R[K], Exclude<Pop[K], undefined>>
          : `populate needs "${K & string}": the projection excludes it`
        : `"${K & string}" stores another type than the _id of its target`
    : `"${K & string}" is not a reference of the model`
}

/** The keys and options the editor suggests in a `populate`. */
export type SuggestedPopulate<R> = {
  [K in keyof R]?:
    | true
    | {
        filter?: SuggestedFilter<TargetSchema<R[K]>>
        projection?: SuggestedProjection<TargetSchema<R[K]>, TargetVirtuals<R[K]>>
        sort?: SuggestedSort<TargetSchema<R[K]>>
      }
}

/** The `populate` option, on the models that have references. */
export type PopulateOption<R, Pop> = [keyof R] extends [never]
  ? unknown
  : { populate?: Pop & SuggestedPopulate<R> }

/** Whether a path of the projection is the reference or an object above it. */
type IncludedBy<P, K> = {
  [Q in keyof P & string]: K extends Q | `${Q}.${string}` ? true : never
}[keyof P & string]

/**
 * The projection a read asks the server for: an inclusion also returns what it populates, unless it
 * already includes it or an object above it, which MongoDB would take as a path collision.
 */
export type PopulatedProjection<P, Pop> = [keyof Pop] extends [never]
  ? P
  : IsLiteral<P> extends true
    ? Mode<Entries<P>> extends 'inclusion'
      ? P & { [K in keyof Pop as [IncludedBy<P, K>] extends [never] ? K : never]: 1 }
      : P
    : P

type ReadOf<T, X> = X extends { projection: infer P }
  ? Read<TargetDocument<T>, TargetVirtuals<T>, P>
  : Read<TargetDocument<T>, TargetVirtuals<T>, None>

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

/** The documents a read returns, with the references of its `populate` replaced. */
export type Populated<T, R, Pop> = [keyof Pop] extends [never]
  ? T
  : T extends unknown
    ? PopulatedLevel<T, R, Pop, ''>
    : never

/**
 * Checks that each reference is a path of the schema, in one or more types of document, without
 * array indexes, and points to a function or to `{ collection, schema }`. Throws an `Error` when it
 * does not.
 */
export function checkReferences(schema: core.$ZodType, references: object = {}): void {
  const types = documentTypes(schema)

  for (const [name, target] of Object.entries(references)) {
    // `populate` goes through every element of an array, so an index would leave its ids untouched.
    if (name.split('.').some((segment) => /^\d+$/.test(segment))) {
      throw new Error(`references: "${name}" names an array index: a reference takes every element`)
    }

    if (!types.some((type) => schemaAt(type, name, 'filter').length > 0)) {
      throw new Error(`references needs the field "${name}" in the schema`)
    }

    const isTarget =
      typeof target === 'function' ||
      (isPlainObject(target) &&
        typeof target.collection === 'string' &&
        target.schema instanceof core.$ZodType)

    if (!isTarget) {
      throw new Error(
        `references: "${name}" points to neither a function that returns a model nor { collection, schema }`
      )
    }
  }
}

/** The options of a populated reference, named like the driver's. */
export interface PopulateOptions {
  filter?: Document
  projection?: Document
  sort?: Document
}

/** A reference to populate: its field, its target and the options of its query. */
export type PopulateEntry = [field: string, target: ReferenceTarget, options: PopulateOptions]

const POPULATE_OPTIONS = new Set(['filter', 'projection', 'sort'])

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
            message: `"${name}" is not an option of populate: use projection, filter or sort`,
            path: ['populate', field, name]
          })
        } else if (isPlainObject(option)) {
          if (name === 'filter') options.filter = option
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

      entries.push([field, target, options])
    } else {
      issues.push({
        code: 'custom',
        input: value,
        message: 'populate takes true, or { projection, filter, sort }',
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
    entries.map(async ([key, target, { filter, projection, sort }]) => {
      const segments = key.split('.')
      const stored: unknown[] = []

      eachHolder(documents, segments, (holder, field) => stored.push(holder[field] ?? []))

      // Each id once, by its key: many documents of a batch may point to the same one.
      const ids = [...new Map(stored.flat().map((id) => [idKey(id), id])).values()]

      if (ids.length === 0) return

      // The `_id` maps each document back to its reference: when the projection leaves it out, it
      // is asked for and removed afterwards.
      const { _id: idProjection, ...rest } = projection ?? {}
      const withoutId = idProjection === 0 || idProjection === false
      const options: FindOptions = { projection: withoutId ? rest : projection }

      if (session) options.session = session
      if (sort) options.sort = sort

      // In `$and`, so that a `filter` on the `_id` narrows the references instead of replacing them.
      const query: Document = filter
        ? { $and: [{ _id: { $in: ids } }, filter] }
        : { _id: { $in: ids } }
      let found: Document[]

      if (typeof target === 'function') {
        const find = finders.get(target())

        if (!find) throw new Error(`references: "${key}" does not return a model of mongozod`)

        found = await find(query, options)
      } else {
        found = await db().collection(target.collection).find(query, options).toArray()
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

          holder[field] = populated
        } else if (value !== null && value !== undefined) {
          holder[field] = byId.get(idKey(value)) ?? null
        }
      })
    })
  )
}
