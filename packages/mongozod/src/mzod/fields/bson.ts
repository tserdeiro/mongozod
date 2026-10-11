import { Binary, BSONError, Decimal128, ObjectId, UUID } from 'bson'
import { z } from 'zod'

/**
 * An `ObjectId`, recognized by its `_bsontype` as the driver's serializer does. `instanceof` would
 * fail between copies of bson, and between its CommonJS build, which the driver loads, and its ES
 * module build, which an app that imports `bson` gets. Its metadata gives the `$jsonSchema` its
 * BSON type.
 */
const objectIdInstance = z
  .custom<ObjectId>(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      '_bsontype' in value &&
      value._bsontype === 'ObjectId'
  )
  .meta({ bsonType: 'objectId' })

/** The 24-character hex string of an `ObjectId`, as a JSON client sends it, decoded to one. */
const hexToObjectId = z.codec(z.hex().length(24), objectIdInstance, {
  decode: (hex) => ObjectId.createFromHexString(hex),
  encode: (id) => id.toHexString()
})

/**
 * An `ObjectId` field: it takes an `ObjectId`, which the server passes, or its 24-character hex
 * string, which a JSON client sends, and returns an `ObjectId`. `z.encode` turns it back into the
 * hex string, and the `$jsonSchema` of `sync()` checks it as an `objectId`.
 *
 * It imports `bson`, never the driver, so the schemas that use it also run in web and native
 * clients. `bson` is a peer dependency, of the major of your driver: 7 for `mongodb` 7, 6 for
 * `mongodb` 6.
 *
 * @example
 *   import { ObjectId } from 'bson'
 *   import * as mz from 'mongozod/mzod'
 *
 *   const brandSchema = z.object({
 *     _id: mz.objectId().default(() => new ObjectId()),
 *     owner: mz.objectId()
 *   })
 */
export function objectId() {
  // The codec goes first: with the `ObjectId` first, `z.encode` would return it unchanged.
  return z.union([hexToObjectId, objectIdInstance], {
    error: 'Invalid ObjectId: expected an ObjectId or its 24-character hex string'
  })
}

/**
 * A `Decimal128`, recognized by its `_bsontype` like an `ObjectId`. Its metadata gives the
 * `$jsonSchema` its BSON type.
 */
const decimal128Instance = z
  .custom<Decimal128>(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      '_bsontype' in value &&
      value._bsontype === 'Decimal128'
  )
  .meta({ bsonType: 'decimal' })

/** Whether bson takes a string as a `Decimal128` without rounding it. */
function isDecimal128(value: string) {
  try {
    Decimal128.fromString(value)

    return true
  } catch (error) {
    // `fromString` throws a `BSONError` for anything it does not take: say so instead.
    if (BSONError.isBSONError(error)) return false

    throw error
  }
}

/**
 * Whether a number is the decimal it was written as: a double keeps 15 significant digits exact,
 * and a safe integer whole. `0.1 + 0.2`, `0.30000000000000004`, is not.
 */
function isExact(value: number) {
  const [mantissa = ''] = String(Math.abs(value)).split('e')
  const digits = mantissa.replace('.', '').replace(/^0+/, '').replace(/0+$/, '')

  return Number.isSafeInteger(value) || digits.length <= 15
}

const DECIMAL128_ERROR =
  'Invalid Decimal128: expected a Decimal128, its string such as "10.50", or a number'

/**
 * A `Decimal128` field, the BSON type for money: it takes a `Decimal128`, which the server passes,
 * its string, such as `'10.50'`, or a number, as a JSON client sends them, and returns a
 * `Decimal128`. A string that bson would round, with more than 34 digits, fails, and so does a
 * number that is not the decimal it was written as, with more than 15 significant digits, such as
 * the `0.30000000000000004` of `0.1 + 0.2`: it asks for the string instead. `z.encode` turns it
 * back into the string, and the `$jsonSchema` of `sync()` checks it as a `decimal`.
 *
 * @example
 *   import * as mz from 'mongozod/mzod'
 *
 *   const invoiceSchema = z.object({ total: mz.decimal128() })
 */
export function decimal128() {
  const input = z.union(
    [
      z.string().refine(isDecimal128, DECIMAL128_ERROR),
      z
        .number()
        .refine(
          isExact,
          'has more than 15 significant digits, which a number cannot keep: send it as a string'
        ),
      decimal128Instance
    ],
    { error: DECIMAL128_ERROR }
  )

  return z.codec(input, decimal128Instance, {
    decode: (value) => (typeof value === 'object' ? value : Decimal128.fromString(String(value))),
    encode: (value) => value.toString()
  })
}

/**
 * A `Binary`, the type the driver reads binary data as, recognized by its `_bsontype` like an
 * `ObjectId`. Its metadata gives the `$jsonSchema` its BSON type.
 */
const binaryInstance = z
  .custom<Binary>(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      '_bsontype' in value &&
      value._bsontype === 'Binary'
  )
  .meta({ bsonType: 'binData' })

const BINARY_ERROR =
  'Invalid binary: expected a Binary, a Uint8Array or the base64 string of its bytes'

/**
 * A binary field: it takes the base64 string of its bytes, which a JSON client sends, a
 * `Uint8Array` or a `Buffer`, which the server passes, or a `Binary`, as the driver reads it, and
 * returns a `Binary`, so its type is the one reads return. A `Binary` passes as it is, with its
 * subtype; the others become a generic one, subtype 0, as the driver stores bytes. `z.encode` turns
 * it back into base64, and the `$jsonSchema` of `sync()` checks it as `binData`.
 *
 * @example
 *   import * as mz from 'mongozod/mzod'
 *
 *   const fileSchema = z.object({ name: z.string(), data: mz.binary() })
 */
// The return type is written out: TypeScript 7 would emit `Uint8Array<ArrayBufferLike>`, which
// TypeScript 5.5, the minimum, does not take.
export function binary(): z.ZodCodec<
  z.ZodUnion<
    readonly [z.ZodBase64, z.ZodCustom<Uint8Array, Uint8Array>, z.ZodCustom<Binary, Binary>]
  >,
  z.ZodCustom<Binary, Binary>
> {
  const input = z.union(
    [
      z.base64({ error: BINARY_ERROR }),
      z.custom<Uint8Array>((value) => value instanceof Uint8Array),
      binaryInstance
    ],
    { error: BINARY_ERROR }
  )

  return z.codec(input, binaryInstance, {
    decode: (value) => {
      if (typeof value === 'string') return Binary.createFromBase64(value)

      return value instanceof Uint8Array ? new Binary(value) : value
    },
    encode: (value) => value.toString('base64')
  })
}

/**
 * A `UUID`, a `Binary` of subtype 4, recognized by its `_bsontype` and subtype like an `ObjectId`.
 * Its metadata gives the `$jsonSchema` its BSON type.
 */
const uuidInstance = z
  .custom<UUID>(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      '_bsontype' in value &&
      value._bsontype === 'Binary' &&
      'sub_type' in value &&
      value.sub_type === Binary.SUBTYPE_UUID
  )
  .meta({ bsonType: 'binData' })

const UUID_ERROR = 'Invalid UUID: expected a UUID or its string'

/**
 * A UUID field, stored as a `Binary` of subtype 4, which takes 16 bytes where its string takes 36:
 * it takes the string of a UUID, which a JSON client sends, or a `UUID`, as the driver reads it,
 * and returns a `UUID`, so its type is the one reads return. `z.encode` and `JSON.stringify` turn
 * it back into the string, and the `$jsonSchema` of `sync()` checks it as `binData`.
 *
 * @example
 *   import { UUID } from 'bson'
 *   import * as mz from 'mongozod/mzod'
 *
 *   const sessionSchema = z.object({ _id: mz.uuid().default(() => new UUID()), user: mz.uuid() })
 */
export function uuid() {
  const input = z.union([z.uuid({ error: UUID_ERROR }), uuidInstance], { error: UUID_ERROR })

  return z.codec(input, uuidInstance, {
    // `toUUID()` also turns a `Binary` of subtype 4 into a `UUID`, which has `toHexString()`.
    decode: (value) => (typeof value === 'string' ? new UUID(value) : value.toUUID()),
    encode: (value) => value.toHexString()
  })
}
