import { MongoClient } from 'mongodb'
import { afterAll, beforeAll, beforeEach, expect, expectTypeOf, inject, test } from 'vitest'
import { z } from 'zod'

import { mongozod } from '../mongozod'

import { populate } from './populate'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-mz-populate')

beforeAll(() => client.connect())
afterAll(() => client.close())
beforeEach(() => db.dropDatabase())

const organizationSchema = z.object({
  _id: z.string(),
  billingEmail: z.string(),
  name: z.string(),
  slug: z.string()
})

const brandSchema = z.object({ _id: z.string(), name: z.string(), organization: z.string() })

const brandsPopulate = populate({
  organization: organizationSchema.pick({ _id: true, name: true, slug: true })
})

test('true asks for the whole whitelist, and a projection for some of its fields', () => {
  expect(brandsPopulate.parse({ organization: true })).toEqual({
    organization: { projection: { _id: 1, name: 1, slug: 1 } }
  })
  expect(brandsPopulate.parse({ organization: { name: true, slug: 1 } })).toEqual({
    organization: { projection: { name: 1, slug: 1 } }
  })
  expect(brandsPopulate.parse({ organization: undefined })).toEqual({})
})

test('a client never gets more than the whitelist', () => {
  expect(brandsPopulate.safeParse({ organization: { billingEmail: 1 } }).success).toBe(false)
  expect(brandsPopulate.safeParse({ organization: { name: 0 } }).success).toBe(false)
  expect(brandsPopulate.safeParse({ organization: {} }).error?.issues).toMatchObject([
    {
      message: 'takes true, or an object with 1 or true for some of its fields',
      path: ['organization']
    }
  ])
  expect(brandsPopulate.safeParse({ owner: true }).success).toBe(false)
  // Nothing expands nothing.
  expect(z.object({ populate: brandsPopulate }).parse({})).toEqual({})
  expectTypeOf<z.input<typeof brandsPopulate>>().toEqualTypeOf<
    { organization?: true | { _id?: 1 | true; name?: 1 | true; slug?: 1 | true } } | undefined
  >()
})

test('a whitelist without fields throws, since {} would be the whole document', () => {
  expect(() => populate({ organization: organizationSchema.pick({}) })).toThrow(
    'mz.populate: "organization" declares no fields: pick at least one'
  )
  expect(() => populate({ organization: z.object({}) })).toThrow('declares no fields')
})

test('the router passes it to the model, and each reference may still be its id', async () => {
  const BrandsModel = mongozod({
    collection: 'brands',
    db,
    references: { organization: { collection: 'organizations', schema: organizationSchema } },
    schema: brandSchema
  })

  await db.collection<z.output<typeof organizationSchema>>('organizations').insertOne({
    _id: 'o1',
    billingEmail: 'billing@acme.com',
    name: 'Acme',
    slug: 'acme'
  })
  await BrandsModel.insertOne({ _id: 'b1', name: 'Acme Ads', organization: 'o1' })

  const input = brandsPopulate.parse({ organization: true })
  const brand = await BrandsModel.findOne({ _id: 'b1' }, { populate: input })

  expect(brand?.organization).toEqual({ _id: 'o1', name: 'Acme', slug: 'acme' })
  // A projection that arrives at runtime leaves every field optional, as in any read.
  expectTypeOf<NonNullable<typeof brand>['organization']>().toEqualTypeOf<
    string | { _id?: string; billingEmail?: string; name?: string; slug?: string } | null
  >()
})
