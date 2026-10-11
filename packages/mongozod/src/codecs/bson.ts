import { BSONError, Decimal128, ObjectId } from 'bson'
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
 * clients. Install the `bson` major of your driver: 7 for `mongodb` 7, 6 for `mongodb` 6.
 *
 * @example
 *   ;```ts
 *   import { BSONError, Decimal128, ObjectId } from 'bson'
 *   import { objectId } from 'mongozod/codecs/bson'
 *
 *   const brandSchema = z.object({
 *     _id: objectId().default(() => new ObjectId()),
 *     owner: objectId()
 *   })
 *   ```
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

/** The string of a `Decimal128`, as a JSON client sends it, decoded to one. */
const stringToDecimal128 = z.codec(z.string().refine(isDecimal128), decimal128Instance, {
  decode: (value) => Decimal128.fromString(value),
  encode: (value) => value.toString()
})

/**
 * A `Decimal128` field, the BSON type for money: it takes a `Decimal128`, which the server passes,
 * or its string, such as `'10.50'`, which a JSON client sends, and returns a `Decimal128`. A
 * number is not taken, because JSON loses its precision, and neither is a string that would round,
 * with more than 34 digits. `z.encode` turns it back into the string, and the `$jsonSchema` of
 * `sync()` checks it as a `decimal`.
 *
 * @example
 *   ;```ts
 *   import { decimal128 } from 'mongozod/codecs/bson'
 *
 *   const invoiceSchema = z.object({ total: decimal128() })
 *   ```
 */
export function decimal128() {
  // The codec goes first: with the `Decimal128` first, `z.encode` would return it unchanged.
  return z.union([stringToDecimal128, decimal128Instance], {
    error: 'Invalid Decimal128: expected a Decimal128 or its string, such as "10.50"'
  })
}
