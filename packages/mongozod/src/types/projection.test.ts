import type { ProjectionCheck } from './projection'
import type { Document } from 'mongodb'

import { MongoClient } from 'mongodb'
import { afterAll, beforeAll, describe, expect, expectTypeOf, inject, test } from 'vitest'
import { z } from 'zod'

import { mongozod } from '../mongozod'

const accountSchema = z.object({
  _id: z.string(),
  details: z.discriminatedUnion('plugin', [
    z.object({ loginCustomerId: z.string().optional(), plugin: z.literal('google-ads') }),
    z.object({ plugin: z.literal('wortise-ads') })
  ]),
  enabled: z.boolean().default(true),
  name: z.string()
})

const connectionSchema = z.object({
  _id: z.string(),
  accounts: z.array(accountSchema).default([]),
  credentials: z.object({ accessToken: z.string().optional() }),
  status: z.enum(['active', 'expired']).default('active')
})

const pluginSchema = z.object({
  _id: z.string(),
  connections: z.array(connectionSchema).default([]),
  empty: z.object({ city: z.string() }).nullable(),
  plugin: z.enum(['google-ads', 'wortise-ads']),
  prop: z.object({ nestedProp: z.boolean(), other: z.string() }).optional(),
  tags: z.array(z.string()).default([])
})

/** The connections without their credentials, like adsgpt's `publicPluginSchema`. */
const publicPluginSchema = pluginSchema.extend({
  connections: z.array(connectionSchema.omit({ credentials: true }))
})

type Plugin = z.output<typeof pluginSchema>
type Connection = z.output<typeof connectionSchema>
type Account = z.output<typeof accountSchema>
type Flat<T> = { [K in keyof T]: T[K] }

/** Only checks what compiles, like the model's projections do. */
function project<const P extends ProjectionCheck<typeof pluginSchema, P>>(projection: P) {
  return projection
}

const client = new MongoClient(inject('mongoUri'))
const PluginsModel = mongozod({
  collection: 'plugins',
  db: client.db('mongozod-projection'),
  schema: pluginSchema
})

const stored = pluginSchema.parse({
  _id: 'p',
  connections: [
    {
      _id: 'c1',
      accounts: [
        {
          _id: 'a1',
          details: { loginCustomerId: '1234567890', plugin: 'google-ads' },
          name: 'Google'
        },
        { _id: 'a2', details: { plugin: 'wortise-ads' }, enabled: false, name: 'Wortise' }
      ],
      credentials: { accessToken: 'secret' }
    },
    { _id: 'c2', credentials: {}, status: 'expired' }
  ],
  empty: null,
  plugin: 'google-ads',
  tags: ['x', 'y', 'z']
})

beforeAll(async () => {
  await client.connect()
  await client.db('mongozod-projection').dropDatabase()
  await PluginsModel.insertOne(stored)
})

afterAll(() => client.close())

test('what MongoDB accepts but answers differently does not compile', () => {
  // @ts-expect-error an index is a field name for a projection
  project({ 'connections.0.status': 1 })
  // @ts-expect-error a path that does not exist
  project({ 'connections.stauts': 1 })
  // @ts-expect-error a path through an array of strings
  project({ 'tags.foo': 1 })
  // @ts-expect-error mixes inclusion and exclusion (31253)
  project({ 'connections.credentials': 0, 'plugin': 1 })
  // @ts-expect-error a path and its parent (31249)
  project({ 'connections': 1, 'connections.status': 1 })
  // @ts-expect-error positional through another array
  project({ 'connections.accounts.$': 1 })
  // @ts-expect-error positional in the middle of the path (31394)
  project({ 'connections.$.status': 1 })
  // @ts-expect-error two positional projections (31276)
  project({ 'connections.$': 1, 'tags.$': 1 })
  // @ts-expect-error positional with an exclusion (31254)
  project({ 'connections.$': 1, 'plugin': 0 })
  // @ts-expect-error $slice on a field that is not an array
  project({ plugin: { $slice: 1 } })
  // @ts-expect-error $elemMatch on a nested array (31275)
  project({ 'connections.accounts': { $elemMatch: { enabled: false } } })
  // @ts-expect-error a field the element of $elemMatch does not have
  project({ connections: { $elemMatch: { stauts: 'active' } } })
  // @ts-expect-error a string, which MongoDB returns as a literal value
  project({ plugin: 'literal' })
  // @ts-expect-error a field the nested form does not have
  project({ connections: { stauts: 1 } })

  project({ 'connections.$': 1, 'plugin': 1, 'score': { $meta: 'textScore' } })
  project({ 'connections.accounts': { $slice: [1, 2] }, 'plugin': 1 })
  project({ tags: { $elemMatch: { $eq: 'x' } } })
  expect(true).toBe(true)
})

describe('inclusion', () => {
  test('dotted paths', async () => {
    const result = await PluginsModel.findOne(
      { _id: 'p' },
      { projection: { 'connections.status': 1, 'prop.nestedProp': 1 } }
    )

    expect(result).toEqual({ _id: 'p', connections: [{ status: 'active' }, { status: 'expired' }] })
    expectTypeOf(result).toEqualTypeOf<{
      _id: string
      connections: Array<{ status: 'active' | 'expired' }>
      prop?: { nestedProp: boolean }
    } | null>()
  })

  test('the nested form gives the same', async () => {
    const result = await PluginsModel.findOne(
      { _id: 'p' },
      { projection: { connections: { accounts: { enabled: 1 }, status: 1 } } }
    )

    expect(result).toEqual({
      _id: 'p',
      connections: [
        { accounts: [{ enabled: true }, { enabled: false }], status: 'active' },
        { accounts: [], status: 'expired' }
      ]
    })
    expectTypeOf(result).toEqualTypeOf<{
      _id: string
      connections: Array<{ accounts: Array<{ enabled: boolean }>; status: 'active' | 'expired' }>
    } | null>()
  })

  test('a field of one type of a discriminated union', async () => {
    const result = await PluginsModel.findOne(
      { _id: 'p' },
      { projection: { 'connections.accounts.details.loginCustomerId': 1 } }
    )

    expect(result).toEqual({
      _id: 'p',
      connections: [
        { accounts: [{ details: { loginCustomerId: '1234567890' } }, { details: {} }] },
        { accounts: [] }
      ]
    })
    expectTypeOf(result).toEqualTypeOf<{
      _id: string
      connections: Array<{
        // oxlint-disable-next-line typescript/no-empty-object-type -- MongoDB returns {} for the Wortise Ads details
        accounts: Array<{ details: { loginCustomerId?: string | undefined } | {} }>
      }>
    } | null>()
  })

  test('a null parent is left out, a null field is kept', async () => {
    const through = await PluginsModel.findOne({ _id: 'p' }, { projection: { 'empty.city': 1 } })
    const direct = await PluginsModel.findOne({ _id: 'p' }, { projection: { empty: 1 } })

    expect(through).toEqual({ _id: 'p' })
    expect(direct).toEqual({ _id: 'p', empty: null })
    expectTypeOf(through).toEqualTypeOf<{ _id: string; empty?: { city: string } } | null>()
    expectTypeOf(direct).toEqualTypeOf<{ _id: string; empty: { city: string } | null } | null>()
  })

  test('_id: 0, positional, $slice and $elemMatch', async () => {
    const withoutId = await PluginsModel.findOne(
      { _id: 'p' },
      { projection: { _id: 0, plugin: 1 } }
    )
    const positional = await PluginsModel.findOne(
      { 'connections._id': 'c2' },
      { projection: { 'connections.$': 1, 'plugin': 1 } }
    )
    const sliced = await PluginsModel.findOne(
      { _id: 'p' },
      { projection: { 'connections.accounts': { $slice: 1 }, 'plugin': 1 } }
    )
    const matched = await PluginsModel.findOne(
      { _id: 'p' },
      { projection: { connections: { $elemMatch: { status: 'expired' } } } }
    )

    expect(withoutId).toEqual({ plugin: 'google-ads' })
    expect(positional).toEqual({
      _id: 'p',
      connections: [stored.connections[1]],
      plugin: 'google-ads'
    })
    expect(sliced).toEqual({
      _id: 'p',
      connections: [{ accounts: [stored.connections[0]?.accounts[0]] }, { accounts: [] }],
      plugin: 'google-ads'
    })
    expect(matched).toEqual({ _id: 'p', connections: [stored.connections[1]] })
    expectTypeOf(withoutId).toEqualTypeOf<{ plugin: Plugin['plugin'] } | null>()
    expectTypeOf(positional).toEqualTypeOf<{
      _id: string
      connections: Connection[]
      plugin: Plugin['plugin']
    } | null>()
    expectTypeOf(sliced).toEqualTypeOf<{
      _id: string
      connections: Array<{ accounts: Account[] }>
      plugin: Plugin['plugin']
    } | null>()
    expectTypeOf(matched).toEqualTypeOf<{ _id: string; connections?: Connection[] } | null>()
  })
  test('an included _id makes an inclusion without other inclusions or exclusions', async () => {
    const id = await PluginsModel.findOne({ _id: 'p' }, { projection: { _id: 1 } })
    const sliced = await PluginsModel.find(
      { _id: 'p' },
      { projection: { _id: true, tags: { $slice: 1 } } }
    )
    const excluded = await PluginsModel.findOne({ _id: 'p' }, { projection: { _id: 1, tags: 0 } })

    expect(id).toEqual({ _id: 'p' })
    expect(sliced).toEqual([{ _id: 'p', tags: ['x'] }])
    expect(excluded).toEqual({ ...stored, tags: undefined })
    expectTypeOf(id).toEqualTypeOf<{ _id: string } | null>()
    expectTypeOf(sliced).toEqualTypeOf<Array<{ _id: string; tags: string[] }>>()
    expectTypeOf(excluded).toEqualTypeOf<Flat<Omit<Plugin, 'tags'>> | null>()
  })
})

describe('exclusion', () => {
  test("excluding the credentials gives adsgpt's public schema", async () => {
    const result = await PluginsModel.findOne(
      { _id: 'p' },
      { projection: { 'connections.credentials': 0 } }
    )

    expect(result).toEqual(publicPluginSchema.parse(stored))
    expectTypeOf(result).toEqualTypeOf<z.output<typeof publicPluginSchema> | null>()
  })

  test('$slice alone keeps everything, $elemMatch with an exclusion too', async () => {
    const sliced = await PluginsModel.findOne({ _id: 'p' }, { projection: { tags: { $slice: 1 } } })
    const matched = await PluginsModel.findOne(
      { _id: 'p' },
      { projection: { connections: { $elemMatch: { status: 'expired' } }, tags: 0 } }
    )

    expect(sliced).toEqual({ ...stored, tags: ['x'] })
    expect(matched).toEqual({ ...stored, connections: [stored.connections[1]], tags: undefined })
    expectTypeOf(sliced).toEqualTypeOf<Plugin | null>()
    expectTypeOf(matched).toEqualTypeOf<Flat<
      Omit<Plugin, 'connections' | 'tags'> & { connections?: Connection[] }
    > | null>()
  })
})

describe('the cursor and the other operations', () => {
  test('project the documents of find and of the findOneAnd operations', async () => {
    const statuses = await PluginsModel.find({ _id: 'p' }).project({
      '_id': 0,
      'connections.status': 1
    })
    const deleted = await PluginsModel.findOneAndDelete(
      { _id: 'missing' },
      { projection: { plugin: 1 } }
    )

    expect(statuses).toEqual([{ connections: [{ status: 'active' }, { status: 'expired' }] }])
    expectTypeOf(statuses).toEqualTypeOf<
      Array<{ connections: Array<{ status: 'active' | 'expired' }> }>
    >()
    expectTypeOf(deleted).toEqualTypeOf<{ _id: string; plugin: Plugin['plugin'] } | null>()
  })

  test('$meta adds the relevance of a text search, which sort can use', async () => {
    await PluginsModel.collection.createIndex({ tags: 'text' })

    const ranked = await PluginsModel.find(
      { $text: { $search: 'x' } },
      {
        projection: { _id: 0, score: { $meta: 'textScore' }, tags: 1 },
        sort: { score: { $meta: 'textScore' } }
      }
    )

    expect(ranked).toEqual([{ score: expect.any(Number), tags: ['x', 'y', 'z'] }])
    expectTypeOf(ranked).toEqualTypeOf<Array<{ score: number; tags: string[] }>>()

    // On a field of the document, the score replaces its value.
    const replaced = await PluginsModel.findOne(
      { $text: { $search: 'x' } },
      { projection: { tags: { $meta: 'textScore' } } }
    )

    expect(replaced).toEqual({ ...stored, tags: expect.any(Number) })
    expectTypeOf(replaced).toEqualTypeOf<Flat<Omit<Plugin, 'tags'> & { tags: number }> | null>()
    // @ts-expect-error MongoDB puts the score inside the object
    project({ 'prop.score': { $meta: 'textScore' } })
  })

  test('a projection that arrives at runtime leaves any field on its paths optional', async () => {
    const fromClient: { 'connections.status'?: 0 | 1; 'plugin'?: 0 | 1 } = {
      'connections.status': 1
    }
    const result = await PluginsModel.findOne({ _id: 'p' }, { projection: fromClient })

    expect(result).toEqual({ _id: 'p', connections: [{ status: 'active' }, { status: 'expired' }] })

    type Result = NonNullable<typeof result>

    expectTypeOf<Result['_id']>().toEqualTypeOf<string>()
    expectTypeOf<Result['plugin']>().toEqualTypeOf<Plugin['plugin'] | undefined>()
  })

  test("one typed as the driver's Document leaves every field optional", async () => {
    const projection: Document = { _id: 0, plugin: 1 }
    const result = await PluginsModel.findOne({ _id: 'p' }, { projection })

    expect(result).toEqual({ plugin: 'google-ads' })
    expectTypeOf(result).toEqualTypeOf<Partial<Plugin> | null>()
  })
})
