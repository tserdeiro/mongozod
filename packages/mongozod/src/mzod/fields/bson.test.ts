import type { Decimal128Extended } from 'bson'
import type { WithId } from 'mongodb'

import { Binary, Decimal128, ObjectId, UUID } from 'bson'
import {
  Binary as DriverBinary,
  Decimal128 as DriverDecimal128,
  MongoClient,
  ObjectId as DriverObjectId,
  UUID as DriverUUID
} from 'mongodb'
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

import { toJsonSchema } from '../../model/json-schema'
import { mongozod } from '../../mongozod'
import { filter } from '../filter'
import { update } from '../update'

import { binary, decimal128, objectId, uuid } from './bson'

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
    expectTypeOf<z.input<typeof schema>>().toEqualTypeOf<
      string | number | Decimal128 | Decimal128Extended
    >()
    expectTypeOf<z.output<typeof schema>>().toEqualTypeOf<Decimal128>()
  })

  test('takes the JSON of a Decimal128, so a document sent as JSON comes back', () => {
    const schema = decimal128()
    const sent: unknown = JSON.parse(JSON.stringify(Decimal128.fromString('10.50')))

    expect(sent).toEqual({ $numberDecimal: '10.50' })
    expect(schema.parse(sent).toString()).toBe('10.50')
    expect(schema.safeParse({ $numberDecimal: 'ten' }).success).toBe(false)
    expect(schema.safeParse({ $numberDecimal: '1', unit: 'USD' }).success).toBe(false)
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

  test('$inc and $mul take what the field parses, so an amount stays exact', async () => {
    const InvoicesModel = mongozod({ collection: 'invoices', db, schema: invoiceSchema })
    const invoiceUpdate = update(invoiceSchema, { $inc: ['total'] })

    await InvoicesModel.insertOne({ _id: 'i1', total: '10.10' })
    await InvoicesModel.updateOne({ _id: 'i1' }, { $inc: { total: '0.10' } })
    await InvoicesModel.updateOne({ _id: 'i1' }, invoiceUpdate.parse({ $inc: { total: '0.05' } }))
    await InvoicesModel.updateOne({ _id: 'i1' }, { $mul: { total: 2 } })

    expect((await InvoicesModel.findOne({ _id: 'i1' }))?.total.toString()).toBe('20.50')
    await expect(
      InvoicesModel.updateOne({ _id: 'i1' }, { $inc: { total: 'ten' } })
    ).rejects.toBeInstanceOf(z.ZodError)
    expect(invoiceUpdate.safeParse({ $inc: { total: 0.1 + 0.2 } }).success).toBe(false)
  })

  test('$inc and $mul leave out the checks of the field, which apply to its value', async () => {
    const accountSchema = z.object({
      _id: z.string(),
      balance: decimal128()
        .refine((balance) => Number(balance.toString()) >= 0, 'balance cannot be negative')
        .optional()
    })
    const AccountsModel = mongozod({ collection: 'accounts', db, schema: accountSchema })
    const accountUpdate = update(accountSchema, { $inc: ['balance'] })

    await AccountsModel.insertOne({ _id: 'a1', balance: '100' })
    await AccountsModel.updateOne({ _id: 'a1' }, { $inc: { balance: '-10' } })
    await AccountsModel.updateOne({ _id: 'a1' }, accountUpdate.parse({ $inc: { balance: '-20' } }))
    await AccountsModel.updateOne({ _id: 'a1' }, { $mul: { balance: '-1' } })

    expect((await AccountsModel.findOne({ _id: 'a1' }))?.balance?.toString()).toBe('-70')
    // The value still goes through them.
    await expect(
      AccountsModel.updateOne({ _id: 'a1' }, { $set: { balance: '-1' } })
    ).rejects.toMatchObject({ issues: [{ message: 'balance cannot be negative' }] })
    expect(accountUpdate.safeParse({ $inc: { balance: 'ten' } }).success).toBe(false)
  })
})

describe('binary()', () => {
  const fileSchema = z.object({ _id: z.string(), data: binary(), name: z.string() })
  const bytes = new Uint8Array([104, 105])

  test('takes base64, a Uint8Array, a Buffer or a Binary, and returns a Binary', () => {
    const schema = binary()
    const md5 = new Binary(bytes, Binary.SUBTYPE_MD5)

    for (const value of ['aGk=', bytes, Buffer.from('hi'), new DriverBinary(bytes)]) {
      const parsed = schema.parse(value)

      expect([parsed._bsontype, parsed.sub_type, [...parsed.value()]]).toEqual([
        'Binary',
        0,
        [104, 105]
      ])
    }

    // A Binary passes as it is, with its subtype: a UUID stays a UUID.
    expect(schema.parse(md5)).toBe(md5)
    expect(schema.parse(new UUID())).toBeInstanceOf(UUID)
    expectTypeOf<z.input<typeof schema>>().toEqualTypeOf<string | Uint8Array | Binary>()
    expectTypeOf<z.output<typeof schema>>().toEqualTypeOf<Binary>()
  })

  test('rejects anything else with one message', () => {
    for (const value of ['not base64!', 42, null, { _bsontype: 'ObjectId' }]) {
      expect(binary().safeParse(value).error?.issues).toMatchObject([
        {
          message:
            'Invalid binary: expected a Binary, a Uint8Array or the base64 string of its bytes'
        }
      ])
    }
  })

  test('encodes back to base64, and is binData in the $jsonSchema', () => {
    expect(z.encode(fileSchema, { _id: 'f1', data: new Binary(bytes), name: 'hi.txt' })).toEqual({
      _id: 'f1',
      data: 'aGk=',
      name: 'hi.txt'
    })
    expect(toJsonSchema(fileSchema).properties.data).toEqual({ bsonType: 'binData' })
  })

  test('a model stores base64 as bytes, and its reads write back as they are', async () => {
    const FilesModel = mongozod({ collection: 'files', db, schema: fileSchema })

    await FilesModel.insertOne({ _id: 'f1', data: 'aGk=', name: 'hi.txt' })

    const stored = await FilesModel.findOne({ _id: 'f1' })

    if (!stored) throw new Error('the file was not stored')

    // The driver reads bytes as a `Binary`, the type of the field, which a replacement takes.
    expect([...stored.data.value()]).toEqual([104, 105])
    await FilesModel.replaceOne({ _id: 'f1' }, { ...stored, name: 'hello.txt' })

    expect(await db.collection('files').countDocuments({ data: { $type: 'binData' } })).toBe(1)
    expect(await FilesModel.findOne({ _id: 'f1' })).toMatchObject({ name: 'hello.txt' })
  })
})

describe('uuid()', () => {
  const sessionSchema = z.object({ _id: uuid().default(() => new UUID()), user: uuid() })
  const text = '0f1aef5a-e7a8-4f60-811b-6685550d99ff'

  test('takes the string of a UUID, a UUID or a Binary of subtype 4, and returns a UUID', () => {
    const schema = uuid()

    for (const value of [
      text,
      text.toUpperCase(),
      new UUID(text),
      new DriverBinary(new UUID(text).buffer, 4)
    ]) {
      const parsed = schema.parse(value)

      // The UUID of the driver's copy of bson, for its Binary: recognized by its subtype.
      expect([parsed._bsontype, parsed.sub_type, parsed.toHexString()]).toEqual(['Binary', 4, text])
    }

    expectTypeOf<z.input<typeof schema>>().toEqualTypeOf<string | UUID>()
    expectTypeOf<z.output<typeof schema>>().toEqualTypeOf<UUID>()
  })

  test('rejects anything else with one message', () => {
    for (const value of [
      'not-a-uuid',
      '0f1aef5ae7a84f60811b6685550d99ff',
      new Binary(new Uint8Array(16)),
      42,
      null
    ]) {
      expect(uuid().safeParse(value).error?.issues).toMatchObject([
        { message: 'Invalid UUID: expected a UUID or its string' }
      ])
    }
  })

  test('encodes back to the string, as JSON does, and is binData in the $jsonSchema', () => {
    const session = sessionSchema.parse({ user: text })

    expect(z.encode(sessionSchema, session)).toEqual({ _id: session._id.toHexString(), user: text })
    expect(JSON.parse(JSON.stringify(session))).toEqual({
      _id: session._id.toHexString(),
      user: text
    })
    expect(toJsonSchema(sessionSchema).properties.user).toEqual({ bsonType: 'binData' })
  })

  test('a model stores a Binary of subtype 4, which reads return as a UUID', async () => {
    const SessionsModel = mongozod({ collection: 'sessions', db, schema: sessionSchema })

    const { document } = await SessionsModel.insertOne({ user: text })
    const stored = await SessionsModel.findOne({ _id: document._id, user: new UUID(text) })

    expect(stored?.user).toBeInstanceOf(DriverUUID)
    expect(stored?.user.toHexString()).toBe(text)
    expect(await db.collection('sessions').countDocuments({ user: { $type: 'binData' } })).toBe(1)
    expectTypeOf(stored).toEqualTypeOf<WithId<{ _id: UUID; user: UUID }> | null>()

    // The string a client sends through mz becomes a UUID, which the filter needs.
    const sessionFilter = filter(sessionSchema, { user: ['$eq', '$in'] })

    expect(await SessionsModel.countDocuments(sessionFilter.parse({ user: text }))).toBe(1)
    expect(await SessionsModel.countDocuments(sessionFilter.parse({ user: { $in: [text] } }))).toBe(
      1
    )
  })
})
