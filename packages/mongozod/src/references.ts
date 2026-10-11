import type { ModelSchema, None, Output } from './model'
import type { Entries, IsLiteral, Mode, ProjectionCheck, SuggestedProjection } from './projection'
import type { Read, Virtuals } from './virtuals'
import type { ClientSession, Db, Document, FindOptions, Flatten, WithId } from 'mongodb'

import { BSON } from 'mongodb'
import { z } from 'zod'
import * as core from 'zod/v4/core'

import { documentTypes } from './document-types'
import { isPlainObject } from './is-plain-object'
import { schemaAt } from './schema-at'

type Simplify<T> = { [K in keyof T]: T[K] }

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

/** The keys of every type of document. */
type FieldsOf<O> = O extends unknown ? keyof O : never

/**
 * The `references` of a model: the fields that store the `_id` of another document, or an array of
 * them, in one or more types of document. Each target is a `ReferenceTarget`, which `populate`
 * checks: checking it here makes models that reference each other, or themselves, circular types.
 */
export type References<S extends ModelSchema> = {
  [K in FieldsOf<Output<S>>]?: unknown
}

/** The keys of `references` that are not fields of the schema. */
export type UnknownReferences<S extends ModelSchema, R> = {
  [K in Exclude<keyof R, FieldsOf<Output<S>>>]: `"${K & string}" is not a field of the schema`
}

type TargetSchema<T> = T extends () => { readonly schema: infer TS extends ModelSchema }
  ? TS
  : T extends { schema: infer TS extends ModelSchema }
    ? TS
    : never

type TargetVirtuals<T> = T extends () => { readonly virtuals: infer TV } ? TV : None

type TargetDocument<T> = WithId<Output<TargetSchema<T>>>

/** The values a field stores in the types of document that have it: the ids, or arrays of them. */
type FieldIds<O, K> = O extends unknown
  ? K extends keyof O
    ? Flatten<Exclude<O[K], null | undefined>>
    : never
  : never

type PopulateValueCheck<T, X> = X extends true
  ? true
  : X extends object
    ? ProjectionCheck<TargetSchema<T>, X, TargetVirtuals<T>>
    : 'populate takes true, or a projection of the referenced document'

/**
 * Checks a `populate`: each key is a reference of the model, whose field stores the `_id` of its
 * target, and the projection of the read does not exclude it. Each value is `true`, for the whole
 * document, or a projection of it, checked like the target's.
 */
export type PopulateCheck<S extends ModelSchema, R, Pop, P> = {
  [K in keyof Pop]: K extends keyof R
    ? [TargetSchema<R[K]>] extends [never]
      ? `"${K & string}" points to neither a function that returns a model nor { collection, schema }`
      : [FieldIds<Output<S>, K>] extends [TargetDocument<R[K]>['_id']]
        ? K extends keyof P
          ? [P[K]] extends [0 | false]
            ? `populate needs "${K & string}": the projection excludes it`
            : PopulateValueCheck<R[K], Exclude<Pop[K], undefined>>
          : PopulateValueCheck<R[K], Exclude<Pop[K], undefined>>
        : `"${K & string}" stores another type than the _id of its target`
    : `"${K & string}" is not a reference of the model`
}

/** The keys and projections the editor suggests in a `populate`. */
export type SuggestedPopulate<R> = {
  [K in keyof R]?: true | SuggestedProjection<TargetSchema<R[K]>, TargetVirtuals<R[K]>>
}

/** The `populate` option, on the models that have references. */
export type PopulateOption<R, Pop> = [keyof R] extends [never]
  ? unknown
  : { populate?: Pop & SuggestedPopulate<R> }

/** The projection a read asks the server for: an inclusion also returns what it populates. */
export type PopulatedProjection<P, Pop> = [keyof Pop] extends [never]
  ? P
  : IsLiteral<P> extends true
    ? Mode<Entries<P>> extends 'inclusion'
      ? P & { [K in keyof Pop]: 1 }
      : P
    : P

type ReadOf<T, X> = X extends true
  ? Read<TargetDocument<T>, TargetVirtuals<T>, None>
  : Read<TargetDocument<T>, TargetVirtuals<T>, X>

/** A populated field: the document, or `null` when it is missing; an array keeps the ones found. */
type PopulatedValue<F, T, X> =
  | (Exclude<F, null | undefined> extends ReadonlyArray<unknown>
      ? Array<ReadOf<T, X>>
      : ReadOf<T, X> | null)
  | Extract<F, null | undefined>

/**
 * One type of document with its references populated. A reference that may not have been asked
 * for, as in a `populate` that arrives at runtime, may still be the id.
 */
type PopulatedOption<T, R, Pop> = Simplify<{
  [K in keyof T]: K extends keyof Pop & keyof R
    ?
        | PopulatedValue<T[K], R[K], Exclude<Pop[K], undefined>>
        | (Pick<Pop, K> extends Required<Pick<Pop, K>> ? never : T[K])
    : T[K]
}>

/** The documents a read returns, with the references of its `populate` replaced. */
export type Populated<T, R, Pop> = [keyof Pop] extends [never]
  ? T
  : T extends unknown
    ? PopulatedOption<T, R, Pop>
    : never

/**
 * Checks that each reference is a top-level field of the schema, in one or more types of document,
 * and points to a function or to `{ collection, schema }`. Throws an `Error` when it does not.
 */
export function checkReferences(schema: core.$ZodType, references: object = {}): void {
  const types = documentTypes(schema)

  for (const [name, target] of Object.entries(references)) {
    // `populate` reads the top-level field, so a path would leave its ids untouched.
    if (name.includes('.')) {
      throw new Error(`references takes top-level fields, and "${name}" is a path`)
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

/** A reference to populate: its field, its target and the projection of the target, if any. */
export type PopulateEntry = [field: string, target: ReferenceTarget, projection?: Document]

/**
 * Validates a `populate` at runtime, like its types: each key is a reference of the model, and each
 * value is `true` or a projection. Throws a `ZodError` otherwise.
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
      entries.push([field, target])
    } else if (isPlainObject(value)) {
      entries.push([field, target, value])
    } else {
      issues.push({
        code: 'custom',
        input: value,
        message: 'populate takes true, or a projection of the referenced document',
        path: ['populate', field]
      })
    }
  }

  if (issues.length > 0) throw new z.ZodRealError(issues)

  return entries
}

/** An id as a key of a map: two ids are the same key when MongoDB finds one with the other. */
function idKey(id: unknown) {
  return BSON.EJSON.stringify(id)
}

/**
 * Replaces each reference of the documents with the document it points to, in place, with one `$in`
 * query per reference. A missing document becomes `null`, and an array keeps the ones found. The
 * queries share the session of the read, so they see the writes of its transaction.
 */
export async function populateDocuments(
  documents: readonly Document[],
  entries: readonly PopulateEntry[],
  db: () => Db,
  session: ClientSession | undefined
): Promise<void> {
  await Promise.all(
    entries.map(async ([key, target, projection]) => {
      // Each id once, by its key: many documents of a batch may point to the same one.
      const ids = [
        ...new Map(
          documents.flatMap((document) => document[key] ?? []).map((id) => [idKey(id), id])
        ).values()
      ]

      if (ids.length === 0) return

      // The `_id` maps each document back to its reference: when the projection leaves it out, it
      // is asked for and removed afterwards.
      const { _id: idProjection, ...rest } = projection ?? {}
      const withoutId = idProjection === 0 || idProjection === false
      const options: FindOptions = { projection: withoutId ? rest : projection }

      if (session) options.session = session

      const filter = { _id: { $in: ids } }
      let found: Document[]

      if (typeof target === 'function') {
        const find = finders.get(target())

        if (!find) throw new Error(`references: "${key}" does not return a model of mongozod`)

        found = await find(filter, options)
      } else {
        found = await db().collection(target.collection).find(filter, options).toArray()
      }

      const byId = new Map(found.map((document) => [idKey(document._id), document]))

      if (withoutId) for (const document of found) delete document._id

      for (const document of documents) {
        const value = document[key]

        if (Array.isArray(value)) {
          document[key] = value.flatMap((id) => byId.get(idKey(id)) ?? [])
        } else if (value !== null && value !== undefined) {
          document[key] = byId.get(idKey(value)) ?? null
        }
      }
    })
  )
}
