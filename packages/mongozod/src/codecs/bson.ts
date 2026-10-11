import { ObjectId } from 'bson'
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
 *   import { ObjectId } from 'bson'
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
