import { Decimal128, ObjectId } from 'bson'
import { Decimal128 as DriverDecimal128, MongoClient, ObjectId as DriverObjectId } from 'mongodb'
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

import { decimal128, objectId } from './bson'

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

describe('decimal128()', () => {
  const invoiceSchema = z.object({ _id: z.string(), total: decimal128() })

  test('takes a Decimal128, its string or an exact number, and returns a Decimal128', () => {
    const schema = decimal128()

    expect(schema.parse('10.50').toString()).toBe('10.50')
    expect(schema.parse(19.99 * 3).toString()).toBe('59.97')
    expect(schema.parse(Number.MAX_SAFE_INTEGER).toString()).toBe('9007199254740991')
    expect(schema.parse('-1E+3').toString()).toBe('-1E+3')
    expect(schema.parse(Decimal128.fromString('0.1')).toString()).toBe('0.1')
    // The driver loads the CommonJS build of bson, and this test its ES module build.
    expect(schema.parse(DriverDecimal128.fromString('2.5')).toString()).toBe('2.5')
    expectTypeOf<z.input<typeof schema>>().toEqualTypeOf<string | number | Decimal128>()
    expectTypeOf<z.output<typeof schema>>().toEqualTypeOf<Decimal128>()
  })

  test('rejects a string bson would round or not take, and anything else', () => {
    const tooPrecise = `0.${'1'.repeat(40)}`

    for (const value of ['abc', '1.2.3', ' 10', '', tooPrecise, null, { _bsontype: 'Long' }]) {
      expect(decimal128().safeParse(value).error?.issues).toMatchObject([
        {
          message:
            'Invalid Decimal128: expected a Decimal128, its string such as "10.50", or a number'
        }
      ])
    }
  })

  test('asks for the string of a number that is not the decimal it was written as', () => {
    // `0.1 + 0.2` is `0.30000000000000004`, and JSON rounds a number with more than 15 digits.
    for (const value of [0.1 + 0.2, JSON.parse('12345678901234567.89')]) {
      expect(decimal128().safeParse(value).error?.issues).toMatchObject([
        {
          message:
            'has more than 15 significant digits, which a number cannot keep: send it as a string'
        }
      ])
    }
  })

  test('encodes back to the string, and is a decimal in the $jsonSchema', () => {
    expect(z.encode(invoiceSchema, { _id: 'i1', total: Decimal128.fromString('10.50') })).toEqual({
      _id: 'i1',
      total: '10.50'
    })
    expect(toJsonSchema(invoiceSchema).properties.total).toEqual({ bsonType: 'decimal' })
  })

  test('a model stores a Decimal128 from its string, and mzod compares with one', async () => {
    const InvoicesModel = mongozod({ collection: 'invoices', db, schema: invoiceSchema })
    const invoicesFilter = filter(invoiceSchema, { total: ['$gte'] })

    await InvoicesModel.insertMany([
      { _id: 'i1', total: '10.50' },
      { _id: 'i2', total: Decimal128.fromString('99.99') }
    ])

    expect(await db.collection('invoices').countDocuments({ total: { $type: 'decimal' } })).toBe(2)
    expect(await InvoicesModel.find(invoicesFilter.parse({ total: { $gte: '50' } }))).toMatchObject(
      [{ _id: 'i2' }]
    )
  })
})
