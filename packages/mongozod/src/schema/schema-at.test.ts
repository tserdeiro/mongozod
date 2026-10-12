import type { PathMode } from './schema-at'
import type * as core from 'zod/v4/core'

import { describe, expect, expectTypeOf, test } from 'vitest'
import { z } from 'zod'

import { type SchemaAt, schemaAt } from './schema-at'

const nodeSchema = z.object({
  value: z.string(),
  get children() {
    return z.array(nodeSchema)
  }
})

const authorSchema = z.object({ name: z.string(), nickname: z.string().optional() })

const schema = z.object({
  _id: z.uuidv4(),
  author: authorSchema.optional(),
  connections: z
    .array(z.object({ _id: z.string(), accounts: z.array(z.object({ enabled: z.boolean() })) }))
    .default([]),
  createdAt: z.union([z.date(), z.iso.datetime().transform((value) => new Date(value))]),
  custom: z.custom<{ a: number }>(),
  data: z.unknown(),
  extra: z.looseObject({ kind: z.string() }),
  metadata: z.record(z.string(), z.number()).optional(),
  pair: z.tuple([z.string(), z.object({ count: z.number() })]),
  payment: z
    .discriminatedUnion('method', [
      z.object({ last4: z.string(), method: z.literal('card') }),
      z.object({ cbu: z.string(), method: z.literal('transfer') })
    ])
    .optional(),
  scores: z.tuple([z.string()], z.number()),
  settings: z.object({ theme: z.string() }).catchall(z.json()),
  tree: nodeSchema
})

type Schema = typeof schema

/** The output type at a path, like the checks of filters and updates read it. */
type At<P extends string, M extends PathMode> = core.output<SchemaAt<Schema, P, M>>

describe('SchemaAt and schemaAt', () => {
  test('find nested fields, and nothing for a path that does not exist', () => {
    expectTypeOf<At<'author.name', 'filter'>>().toEqualTypeOf<string>()
    expectTypeOf<SchemaAt<Schema, 'author.missing', 'filter'>>().toBeNever()

    expect(schemaAt(schema, 'author.name', 'filter')).toEqual([authorSchema.shape.name])
    expect(schemaAt(schema, 'author.missing', 'filter')).toEqual([])
  })

  test('go through arrays in filters and take an index', () => {
    expectTypeOf<At<'connections.accounts.enabled', 'filter'>>().toEqualTypeOf<boolean>()
    expectTypeOf<At<'connections.0._id', 'filter'>>().toEqualTypeOf<string>()

    expect(schemaAt(schema, 'connections.accounts.enabled', 'filter')).toHaveLength(1)
    expect(schemaAt(schema, 'connections.0._id', 'filter')).toHaveLength(1)
  })

  test('name the element in updates, with an index, $, $[] or $[id]', () => {
    expectTypeOf<At<'connections.$[c].accounts.$[].enabled', 'update'>>().toEqualTypeOf<boolean>()
    expectTypeOf<At<'connections.$.accounts.0.enabled', 'update'>>().toEqualTypeOf<boolean>()
    expectTypeOf<SchemaAt<Schema, 'connections.accounts.enabled', 'update'>>().toBeNever()
    expectTypeOf<SchemaAt<Schema, 'connections.$[Account]._id', 'update'>>().toBeNever()

    expect(schemaAt(schema, 'connections.$[c].accounts.$[].enabled', 'update')).toHaveLength(1)
    expect(schemaAt(schema, 'connections.$.accounts.0.enabled', 'update')).toHaveLength(1)
    expect(schemaAt(schema, 'connections.accounts.enabled', 'update')).toEqual([])
    expect(schemaAt(schema, 'connections.$[Account]._id', 'update')).toEqual([])
  })

  test('only go through arrays in projections', () => {
    expectTypeOf<At<'connections._id', 'projection'>>().toEqualTypeOf<string>()
    expectTypeOf<SchemaAt<Schema, 'connections.0._id', 'projection'>>().toBeNever()

    expect(schemaAt(schema, 'connections._id', 'projection')).toHaveLength(1)
    expect(schemaAt(schema, 'connections.0._id', 'projection')).toEqual([])
  })

  test('take the keys of records, catchalls and loose objects, and anything under unknown', () => {
    expectTypeOf<At<'metadata.clicks', 'update'>>().toEqualTypeOf<number>()
    expectTypeOf<At<'settings.theme', 'update'>>().toEqualTypeOf<string>()
    expectTypeOf<At<'settings.layout', 'update'>>().toEqualTypeOf<z.core.util.JSONType>()
    expectTypeOf<At<'extra.kind', 'filter'>>().toEqualTypeOf<string>()
    expectTypeOf<At<'extra.anything', 'filter'>>().toBeUnknown()
    expectTypeOf<At<'data.a.b', 'update'>>().toBeUnknown()

    expect(schemaAt(schema, 'metadata.clicks', 'update')).toHaveLength(1)
    expect(schemaAt(schema, 'settings.layout.columns', 'update')).not.toHaveLength(0)
    expect(schemaAt(schema, 'extra.anything', 'filter')).toHaveLength(1)
    expect(schemaAt(schema, 'data.a.b', 'update')).toHaveLength(1)
  })

  test('take an index of a tuple in range, or of its rest, in filters and updates', () => {
    expectTypeOf<At<'pair.0', 'filter'>>().toEqualTypeOf<string>()
    expectTypeOf<At<'pair.1.count', 'update'>>().toEqualTypeOf<number>()
    expectTypeOf<At<'scores.5', 'update'>>().toEqualTypeOf<number>()
    expectTypeOf<SchemaAt<Schema, 'pair.2', 'filter'>>().toBeNever()
    expectTypeOf<SchemaAt<Schema, 'pair.$', 'update'>>().toBeNever()
    expectTypeOf<SchemaAt<Schema, 'pair.0', 'projection'>>().toBeNever()

    expect(schemaAt(schema, 'pair.0', 'filter')).toEqual([schema.shape.pair.def.items[0]])
    expect(schemaAt(schema, 'pair.1.count', 'update')).toHaveLength(1)
    expect(schemaAt(schema, 'scores.5', 'update')).toEqual([schema.shape.scores.def.rest])
    expect(schemaAt(schema, 'pair.2', 'filter')).toEqual([])
    expect(schemaAt(schema, 'pair.$', 'update')).toEqual([])
    expect(schemaAt(schema, 'pair.0', 'projection')).toEqual([])
  })

  test('look into every option of a union', () => {
    expectTypeOf<At<'payment.last4', 'filter'>>().toEqualTypeOf<string>()
    expectTypeOf<At<'payment.method', 'filter'>>().toEqualTypeOf<'card' | 'transfer'>()

    expect(schemaAt(schema, 'payment.last4', 'filter')).toHaveLength(1)
    expect(schemaAt(schema, 'payment.method', 'filter')).toHaveLength(2)
  })

  test('follow recursive schemas, with no depth limit', () => {
    expectTypeOf<At<'tree.children.children.children.value', 'filter'>>().toEqualTypeOf<string>()

    expect(schemaAt(schema, 'tree.children.children.children.value', 'filter')).toHaveLength(1)
  })

  test('stop at transforms, customs and leaves', () => {
    expectTypeOf<SchemaAt<Schema, 'createdAt.year', 'filter'>>().toBeNever()
    expectTypeOf<SchemaAt<Schema, 'custom.a', 'filter'>>().toBeNever()
    expectTypeOf<SchemaAt<Schema, 'author.name.length', 'filter'>>().toBeNever()

    expect(schemaAt(schema, 'createdAt.year', 'filter')).toEqual([])
    expect(schemaAt(schema, 'custom.a', 'filter')).toEqual([])
    expect(schemaAt(schema, 'author.name.length', 'filter')).toEqual([])
  })
})
