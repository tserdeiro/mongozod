import * as core from 'zod/v4/core'

/**
 * The schemas whose BSON type mongozod knows although Zod cannot tell it, such as the `ObjectId` of
 * `objectId()`: the `$jsonSchema` gives each one its `bsonType`.
 */
export const bsonTypes = core.registry<{ bsonType: string }>()
