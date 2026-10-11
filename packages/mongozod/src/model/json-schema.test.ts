import { Decimal128 } from 'mongodb'
import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import * as zm from 'zod/mini'

import { toJsonSchema } from './json-schema'

/** The documented form of a date: a `Date`, or an ISO string that a codec decodes. */
const dateSchema = z.union([
  z.date(),
  z.codec(z.iso.datetime(), z.date(), {
    decode: (iso) => new Date(iso),
    encode: (date) => date.toISOString()
  })
])

describe('toJsonSchema', () => {
  test('gives each field its BSON type, and requires the ones the output always has', () => {
    const schema = z.object({
      _id: z.uuidv4().default(() => crypto.randomUUID()),
      active: z.boolean().default(true),
      big: z.bigint().optional(),
      count: z.number().int(),
      createdAt: z.date(),
      kind: z.enum(['a', 'b']),
      level: z.literal([1, 2]),
      name: z.string().min(1).optional(),
      nothing: z.null(),
      slug: z.templateLiteral(['post-', z.number()])
    })

    expect(toJsonSchema(schema)).toEqual({
      bsonType: 'object',
      properties: {
        _id: { bsonType: 'string' },
        active: { bsonType: 'bool' },
        big: { bsonType: 'long' },
        count: { bsonType: 'number' },
        createdAt: { bsonType: 'date' },
        kind: { enum: ['a', 'b'] },
        level: { enum: [1, 2] },
        name: { bsonType: 'string' },
        nothing: { bsonType: 'null' },
        slug: { bsonType: 'string' }
      },
      required: ['_id', 'active', 'count', 'createdAt', 'kind', 'level', 'nothing', 'slug']
    })
  })

  test('walks nested objects, arrays, tuples, records, unions and nullables', () => {
    const schema = z.object({
      details: z.discriminatedUnion('plugin', [
        z.object({ id: z.string(), plugin: z.literal('google-ads') }),
        z.object({ plugin: z.literal('wortise-ads') })
      ]),
      metadata: z.record(z.string(), z.number()),
      point: z.tuple([z.number(), z.number()]),
      tags: z.array(z.string()).default([]),
      team: z.string().nullable()
    })

    expect(toJsonSchema(schema).properties).toEqual({
      details: {
        anyOf: [
          {
            bsonType: 'object',
            properties: { id: { bsonType: 'string' }, plugin: { enum: ['google-ads'] } },
            required: ['id', 'plugin']
          },
          {
            bsonType: 'object',
            properties: { plugin: { enum: ['wortise-ads'] } },
            required: ['plugin']
          }
        ]
      },
      metadata: { additionalProperties: { bsonType: 'number' }, bsonType: 'object' },
      point: {
        additionalItems: false,
        bsonType: 'array',
        items: [{ bsonType: 'number' }, { bsonType: 'number' }]
      },
      tags: { bsonType: 'array', items: { bsonType: 'string' } },
      team: { anyOf: [{ bsonType: 'string' }, { bsonType: 'null' }] }
    })
  })

  test('leaves without rules what has no BSON type: transforms, customs, unknowns and recursion', () => {
    interface Category {
      children: Category[]
      name: string
    }

    const categorySchema: z.ZodType<Category> = z.object({
      children: z.array(z.lazy(() => categorySchema)),
      name: z.string()
    })
    const schema = z.object({
      category: categorySchema,
      createdAt: z.union([z.date(), z.iso.datetime().transform((value) => new Date(value))]),
      extra: z.unknown(),
      id: z.custom<string>((value) => typeof value === 'string'),
      json: z.json(),
      title: z.string().transform((value) => value.trim())
    })
    const { properties } = toJsonSchema(schema)

    // An ISO string or a Date becomes a Date, but the type of a transform is not known at runtime.
    expect(properties.createdAt).toEqual({})
    expect(properties.extra).toEqual({})
    expect(properties.id).toEqual({})
    expect(properties.title).toEqual({})
    expect(properties.category.properties.children).toEqual({
      bsonType: 'array',
      items: {
        bsonType: 'object',
        properties: { children: { bsonType: 'array' }, name: { bsonType: 'string' } },
        required: ['children', 'name']
      }
    })
    expect(properties.json.anyOf).toContainEqual({ bsonType: 'string' })
  })

  test('takes the end of a pipe or a codec, which is what is stored', () => {
    const schema = z.object({
      count: z.string().pipe(z.coerce.number()),
      createdAt: dateSchema.default(() => new Date())
    })

    expect(toJsonSchema(schema).properties).toEqual({
      count: { bsonType: 'number' },
      createdAt: { bsonType: 'date' }
    })
  })

  test('follows the unknown keys of the object: strict, loose, catchall or kept', () => {
    expect(toJsonSchema(z.strictObject({ name: z.string() }))).toMatchObject({
      additionalProperties: false,
      properties: { _id: { bsonType: 'objectId' } }
    })
    expect(toJsonSchema(z.looseObject({ name: z.string() }))).not.toHaveProperty(
      'additionalProperties'
    )
    expect(toJsonSchema(z.object({ name: z.string() }).catchall(z.number()))).toMatchObject({
      additionalProperties: { bsonType: 'number' }
    })
    expect(toJsonSchema(z.object({ name: z.string() }))).not.toHaveProperty('additionalProperties')
  })

  test('takes the bsonType that the metadata declares, over the one inferred', () => {
    const decimal = z.custom<Decimal128>((value) => value instanceof Decimal128)
    const schema = z.object({
      after: decimal.nullable().meta({ bsonType: 'decimal' }),
      balance: decimal.meta({ bsonType: 'decimal' }),
      before: decimal.meta({ bsonType: 'decimal' }).nullable(),
      count: z.number().meta({ bsonType: 'int' }).min(0),
      mini: zm.custom<Decimal128>().check(zm.meta({ bsonType: 'decimal' })),
      price: z.union([decimal.meta({ bsonType: 'decimal' }), z.number()]).optional(),
      undeclared: decimal
    })

    expect(toJsonSchema(schema).properties).toEqual({
      after: { anyOf: [{ bsonType: 'decimal' }, { bsonType: 'null' }] },
      balance: { bsonType: 'decimal' },
      before: { anyOf: [{ bsonType: 'decimal' }, { bsonType: 'null' }] },
      count: { bsonType: 'int' },
      mini: { bsonType: 'decimal' },
      price: { anyOf: [{ bsonType: 'decimal' }, { bsonType: 'number' }] },
      undeclared: {}
    })
    // @ts-expect-error decimel is not a BSON type
    decimal.meta({ bsonType: 'decimel' })
  })

  test('takes Zod Mini schemas', () => {
    const schema = zm.object({ name: zm.optional(zm.string()), tags: zm.array(zm.string()) })

    expect(toJsonSchema(schema)).toEqual({
      bsonType: 'object',
      properties: {
        name: { bsonType: 'string' },
        tags: { bsonType: 'array', items: { bsonType: 'string' } }
      },
      required: ['tags']
    })
  })
})
