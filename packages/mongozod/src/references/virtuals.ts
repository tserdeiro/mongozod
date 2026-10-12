import type { ModelSchema, Output } from '../model/model'
import type { FieldsOf } from '../schema/document-types'
import type { Entries, IsLiteral, Kind, Mode, Projected } from '../types/projection'
import type { Simplify, UnionToIntersection } from '../utils/type-helpers'
import type { Document, WithId } from 'mongodb'

import { z } from 'zod'
import * as core from 'zod/v4/core'

import { documentTypes } from '../schema/document-types'
import { schemaAt } from '../schema/schema-at'

/**
 * The `virtuals` option of `mongozod()`: fields computed from others, which are not stored. Each
 * one is a schema that picks the fields it reads and transforms them into its value, such as
 * `schema.pick({ firstName: true, lastName: true }).transform(…)`.
 */
export type Virtuals = Record<string, core.$ZodType>

/**
 * The values of the virtuals of a model, built key by key so that each value is resolved: a
 * `.map()` over a read infers into what a value still depends on, and through the schemas of the
 * virtuals it computed the variance of Zod's classes, about 90k instantiations.
 */
export type VirtualValues<V> = UnionToIntersection<
  { [K in keyof V]: { -readonly [P in K]: core.output<V[K]> } }[keyof V]
>

/** The fields a virtual reads: the keys of its input. */
type NeedsOf<X> = keyof core.input<X> & string

type MissingField<O, X> = O extends unknown ? Exclude<NeedsOf<X>, keyof O> : never

type OtherType<O, X> = O extends unknown
  ? {
      [F in NeedsOf<X> & keyof O]: O[F] extends core.input<X>[F] ? never : F
    }[NeedsOf<X> & keyof O]
  : never

type VirtualProblem<O, K extends string, X> =
  K extends FieldsOf<O>
    ? `virtual "${K}" is a field of the schema`
    : core.input<X> extends object
      ? [MissingField<O, X>] extends [never]
        ? [OtherType<O, X>] extends [never]
          ? never
          : `virtual "${K}" reads "${OtherType<O, X>}" with another type than the schema's`
        : `virtual "${K}" needs the field "${MissingField<O, X>}" in the schema`
      : `virtual "${K}" must take an object: pick the fields it reads`

/**
 * Checks each virtual against the documents it computes from: it cannot be named like a field, and
 * it reads fields that every type of document has, with the types they are stored with.
 */
export type VirtualsCheck<S extends ModelSchema, V> = {
  [K in keyof V]: [VirtualProblem<WithId<Output<S>>, K & string, V[K]>] extends [never]
    ? core.$ZodType
    : VirtualProblem<WithId<Output<S>>, K & string, V[K]>
}

/**
 * The paths of a projection that leave out or change a field a virtual reads, `$meta` included: the
 * score replaces the value of a field.
 */
type Touched<E, N extends string> = E extends [infer Path extends string, Kind]
  ? Path extends N | `${N}.${string}`
    ? Path
    : never
  : never

/**
 * The virtuals a projection returns: the ones an inclusion asks for, or the ones an exclusion
 * neither leaves out nor reaches through the fields they read.
 */
type ComputedKeys<V, P, E> =
  Mode<E> extends 'inclusion'
    ? {
        [K in keyof V]: K extends keyof P ? ([P[K]] extends [1 | true] ? K : never) : never
      }[keyof V]
    : {
        [K in keyof V]: K extends keyof P
          ? never
          : [Touched<E, NeedsOf<V[K]>>] extends [never]
            ? K
            : never
      }[keyof V]

type WithVirtuals<T, X> = T extends unknown ? Simplify<T & X> : never

/**
 * The fields of a projection: the virtuals it leaves out are not sent to the server, so they do not
 * decide whether it includes or excludes.
 */
type FieldsProjection<V, P> = Omit<
  P,
  { [K in keyof V & keyof P]: [P[K]] extends [0 | false] ? K : never }[keyof V & keyof P]
>

/**
 * The document a read returns: the projected document plus the virtuals the projection asks for or
 * keeps. Without a projection, every virtual. With one that arrives at runtime, any of them.
 */
export type Read<O, V, P> = [keyof V] extends [never]
  ? Projected<O, P>
  : [keyof P] extends [never]
    ? WithVirtuals<O, VirtualValues<V>>
    : IsLiteral<P> extends false
      ? WithVirtuals<Projected<O, P>, Partial<VirtualValues<V>>>
      : WithVirtuals<
          Projected<O, FieldsProjection<V, P>>,
          Pick<
            VirtualValues<V>,
            ComputedKeys<V, P, Entries<FieldsProjection<V, P>>> & keyof VirtualValues<V>
          >
        >

/** A virtual at runtime: its schema and the fields it reads. */
export interface Virtual {
  needs: readonly string[]
  schema: core.$ZodType
}

/**
 * The virtuals of a model, with the fields each one reads. Throws an `Error` when one is named like
 * a field, does not take an object or reads a field that a type of document does not have.
 */
export function virtualsOf(
  schema: core.$ZodType,
  virtuals: Record<string, core.$ZodType> = {}
): Map<string, Virtual> {
  const types = documentTypes(schema)

  return new Map(
    Object.entries(virtuals).map(([name, virtual]) => {
      if (name.includes('.') || name.startsWith('$') || schemaAt(schema, name, 'filter').length) {
        throw new Error(
          `virtual "${name}" is not a valid name: it is a field of the schema, has a "." or starts with "$"`
        )
      }

      // A transform pipes the input into its function, so the input is at the start of the pipes.
      let input = virtual

      while (input instanceof core.$ZodPipe) input = input._zod.def.in

      if (!(input instanceof core.$ZodObject)) {
        throw new Error(
          `virtual "${name}" must take an object: pick the fields it reads, as in schema.pick({ … }).transform(…)`
        )
      }

      const needs = Object.keys(input._zod.def.shape)

      for (const need of needs) {
        // Without an `_id` in the schema, the driver generates one.
        const inEveryType = types.every(
          (type) => need === '_id' || schemaAt(type, need, 'filter').length > 0
        )

        if (!inEveryType)
          throw new Error(`virtual "${name}" needs the field "${need}" in the schema`)
      }

      return [name, { needs, schema: virtual }]
    })
  )
}

/**
 * Computes the virtuals of each document, in place, from the fields they read. Throws a `ZodError`
 * when a stored document does not pass the schema of a virtual.
 */
export function computeVirtuals(
  documents: readonly Document[],
  virtuals: ReadonlyMap<string, Virtual>
): void {
  for (const document of documents) {
    for (const [name, { needs, schema }] of virtuals) {
      const fields = needs.filter((need) => Object.hasOwn(document, need))

      document[name] = z.parse(
        schema,
        Object.fromEntries(fields.map((need) => [need, document[need]]))
      )
    }
  }
}
