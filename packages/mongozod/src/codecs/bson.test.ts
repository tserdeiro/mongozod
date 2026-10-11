import { ObjectId } from 'bson'
import { MongoClient, ObjectId as DriverObjectId } from 'mongodb'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  inject,
  test
} from 'vitest'
import { z } from 'zod'

import { toJsonSchema } from '../model/json-schema'
import { mongozod } from '../mongozod'
import { filter } from '../mzod/filter'
import { update } from '../mzod/update'

import { objectId } from './bson'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-codecs-bson')

beforeAll(() => client.connect())
afterAll(() => client.close())
beforeEach(() => db.dropDatabase())

const brandSchema = z.object({
  _id: objectId().default(() => new ObjectId()),
  name: z.string(),
  owner: objectId().optional()
})

const hex = '65c3b9b4f1d2a34b5c6d7e8f'

describe('objectId()', () => {
  test('takes an ObjectId or its hex string, and returns an ObjectId', () => {
    const schema = objectId()

    expect(schema.parse(hex)).toEqual(ObjectId.createFromHexString(hex))
    expect(schema.parse(hex.toUpperCase()).toHexString()).toBe(hex)
    expect(schema.parse(new ObjectId(hex)).toHexString()).toBe(hex)
    expectTypeOf<z.input<typeof schema>>().toEqualTypeOf<string | ObjectId>()
    expectTypeOf<z.output<typeof schema>>().toEqualTypeOf<ObjectId>()
  })

  test("takes the driver's ObjectId, which instanceof would reject", () => {
    // The driver loads the CommonJS build of bson, and this test its ES module build.
    expect(new DriverObjectId(hex)).not.toBeInstanceOf(ObjectId)
    expect(objectId().parse(new DriverObjectId(hex)).toHexString()).toBe(hex)
  })

  test('rejects anything else with one message', () => {
    for (const value of ['65c3', `${hex}0`, 'z'.repeat(24), 42, null, { _bsontype: 'UUID' }]) {
      expect(objectId().safeParse(value).error?.issues).toMatchObject([
        { message: 'Invalid ObjectId: expected an ObjectId or its 24-character hex string' }
      ])
    }
  })

  test('encodes back to the hex string', () => {
    expect(z.encode(brandSchema, { _id: new ObjectId(hex), name: 'Acme' })).toEqual({
      _id: hex,
      name: 'Acme'
    })
  })

  test('is an objectId in the $jsonSchema', () => {
    expect(toJsonSchema(brandSchema).properties).toEqual({
      _id: { bsonType: 'objectId' },
      name: { bsonType: 'string' },
      owner: { bsonType: 'objectId' }
    })
  })
})

describe('in a model', () => {
  const BrandsModel = mongozod({ collection: 'brands', db, schema: brandSchema })

  test('stores an ObjectId, from a hex string or from either build of bson', async () => {
    const { document } = await BrandsModel.insertOne({ _id: hex, name: 'Acme', owner: hex })

    await BrandsModel.insertMany([
      { name: 'Globex', owner: new ObjectId() },
      { name: 'Initech', owner: new DriverObjectId() }
    ])

    expect(document._id.toHexString()).toBe(hex)
    expect(await db.collection('brands').countDocuments({ owner: { $type: 'objectId' } })).toBe(3)
    expect(await BrandsModel.findOne({ _id: new ObjectId(hex) })).toMatchObject({ name: 'Acme' })
  })

  test('takes the hex string a client sends through mz', async () => {
    const { document } = await BrandsModel.insertOne({ name: 'Acme' })
    const id = document._id.toHexString()
    const brandFilter = filter(brandSchema, { _id: ['$eq', '$in'] })
    const brandUpdate = update(brandSchema, { $set: ['owner'] })

    await BrandsModel.updateOne(
      brandFilter.parse({ _id: id }),
      brandUpdate.parse({ $set: { owner: hex } })
    )

    expect(await BrandsModel.findOne(brandFilter.parse({ _id: { $in: [id] } }))).toMatchObject({
      owner: ObjectId.createFromHexString(hex)
    })
  })
})
