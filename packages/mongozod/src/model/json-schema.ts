import type { BSONTypeAlias, Document } from 'mongodb'

import * as core from 'zod/v4/core'

import { uniqueValues } from '../mzod/fields/set'

declare module 'zod/v4/core' {
  interface GlobalMeta {
    /**
     * The BSON type of the field in the `$jsonSchema` of mongozod's `sync()`, for one that Zod does
     * not describe, such as `z.instanceof(Decimal128).meta({ bsonType: 'decimal' })`. It replaces
     * the one mongozod infers. `number` takes any numeric type, and a field of several types is a
     * `z.union` of them. One alias and no array: every Zod schema's `.meta()` type includes it.
     */
    bsonType?: BSONTypeAlias | 'number'
  }
}

/**
 * The `jsonSchema` option of `mongozod()`: `true` for MongoDB's defaults, `strict` and `error`, or
 * the validation level and action. `moderate` does not validate the updates of documents that
 * already fail, such as the old ones of a collection being migrated.
 */
export type JsonSchemaOption =
  | boolean
  | { validationAction?: 'error' | 'warn'; validationLevel?: 'moderate' | 'strict' }

/** The `$jsonSchema` of a schema that has no rule: any value passes. */
const ANY: Document = {}

function isAny(schema: Document) {
  return Object.keys(schema).length === 0
}

/**
 * One of several schemas, each once: any value passes when one of them takes any. A date that is a
 * `Date` or an ISO string decoded by a codec is one `date`.
 */
function anyOf(schemas: Document[]): Document {
  if (schemas.some(isAny)) return ANY

  const unique = [...new Map(schemas.map((schema) => [JSON.stringify(schema), schema])).values()]

  return unique.length === 1 ? (unique[0] ?? ANY) : { anyOf: unique }
}

/**
 * The `$jsonSchema` of a schema, with the `bsonType` its metadata declares, from `.meta()` or
 * `z.meta()`, Zod's API, over the one inferred. On a `.nullable()` it is the type of the value, and
 * `null` still passes, so `.meta()` goes before or after `.nullable()` alike.
 */
function walk(schema: core.$ZodType, seen: ReadonlySet<core.$ZodType>): Document {
  const bsonType = core.globalRegistry.get(schema)?.bsonType

  if (bsonType === undefined) return describe(schema, seen)

  if (schema instanceof core.$ZodNullable) {
    return anyOf([{ ...walk(schema._zod.def.innerType, seen), bsonType }, { bsonType: 'null' }])
  }

  return { ...describe(schema, seen), bsonType }
}

function describe(schema: core.$ZodType, seen: ReadonlySet<core.$ZodType>): Document {
  if (
    schema instanceof core.$ZodCatch ||
    schema instanceof core.$ZodDefault ||
    schema instanceof core.$ZodNonOptional ||
    schema instanceof core.$ZodOptional ||
    schema instanceof core.$ZodPrefault ||
    schema instanceof core.$ZodReadonly
  ) {
    return walk(schema._zod.def.innerType, seen)
  }

  // A recursive schema leads back to itself, and `$jsonSchema` has no `$ref`.
  if (schema instanceof core.$ZodLazy) {
    return seen.has(schema) ? ANY : walk(schema._zod.innerType, new Set([...seen, schema]))
  }

  // What is stored is the output: the end of a pipe, which a transform leaves without rules.
  if (schema instanceof core.$ZodPipe || schema instanceof core.$ZodCodec) {
    return walk(schema._zod.def.out, seen)
  }

  if (schema instanceof core.$ZodNullable) {
    return anyOf([walk(schema._zod.def.innerType, seen), { bsonType: 'null' }])
  }

  if (schema instanceof core.$ZodString || schema instanceof core.$ZodTemplateLiteral) {
    return { bsonType: 'string' }
  }

  if (schema instanceof core.$ZodNumber) return { bsonType: 'number' }
  if (schema instanceof core.$ZodBigInt) return { bsonType: 'long' }
  if (schema instanceof core.$ZodBoolean) return { bsonType: 'bool' }
  if (schema instanceof core.$ZodDate) return { bsonType: 'date' }
  if (schema instanceof core.$ZodNull) return { bsonType: 'null' }
  if (schema instanceof core.$ZodLiteral) {
    return { enum: schema._zod.def.values.filter((value) => value !== undefined) }
  }

  if (schema instanceof core.$ZodEnum) {
    return { enum: core.util.getEnumValues(schema._zod.def.entries) }
  }

  if (schema instanceof core.$ZodArray) {
    const items = walk(schema._zod.def.element, seen)
    const array: Document = isAny(items) ? { bsonType: 'array' } : { bsonType: 'array', items }

    // A set of `mz.set()`: the server also rejects a repeated value, even one that `$push` adds.
    if ((schema._zod.def.checks ?? []).includes(uniqueValues)) array.uniqueItems = true

    return array
  }

  if (schema instanceof core.$ZodTuple) {
    const { items, rest } = schema._zod.def

    return {
      additionalItems: rest ? walk(rest, seen) : false,
      bsonType: 'array',
      items: items.map((item) => walk(item, seen))
    }
  }

  if (schema instanceof core.$ZodRecord) {
    const values = walk(schema._zod.def.valueType, seen)

    return isAny(values)
      ? { bsonType: 'object' }
      : { additionalProperties: values, bsonType: 'object' }
  }

  if (schema instanceof core.$ZodObject) {
    const { catchall, shape } = schema._zod.def
    const fields = Object.entries(shape)
    const required = fields.filter(([, field]) => field._zod.optout !== 'optional')
    const object: Document = {
      bsonType: 'object',
      properties: Object.fromEntries(fields.map(([key, field]) => [key, walk(field, seen)]))
    }

    if (required.length > 0) object.required = required.map(([key]) => key)

    // A `z.strictObject` has a never catchall and a `z.looseObject` an unknown one. A plain
    // `z.object` drops the keys it does not declare, but the stored documents may have them.
    const extra = catchall && walk(catchall, seen)

    if (catchall instanceof core.$ZodNever) object.additionalProperties = false
    else if (extra && !isAny(extra)) object.additionalProperties = extra

    return object
  }

  if (schema instanceof core.$ZodUnion) {
    return anyOf(schema._zod.def.options.map((option) => walk(option, seen)))
  }

  if (schema instanceof core.$ZodIntersection) {
    return { allOf: [walk(schema._zod.def.left, seen), walk(schema._zod.def.right, seen)] }
  }

  // `z.unknown()`, `z.any()`, `z.custom()`, `z.json()`, a transform and what BSON cannot store.
  return ANY
}

/**
 * The `$jsonSchema` of a model's schema, for the documents as stored: the BSON type of each field,
 * the required ones, nested objects and arrays, enums and literals, `null` and unions. Refinements
 * stay in the app, and transforms, customs and recursive schemas have no rules, unless their
 * metadata declares a `bsonType`, as the `mz.objectId()` of `mongozod/mzod` does. Without an
 * `_id` in the schema, the driver's `ObjectId` passes.
 */
export function toJsonSchema(schema: core.$ZodType): Document {
  const jsonSchema = walk(schema, new Set())

  allowId(jsonSchema)

  return jsonSchema
}

/**
 * Declares the `_id` of each type of document that leaves it out and closes or rules its other
 * keys, as a strict object or a catchall does, which would reject the driver's `ObjectId`. A
 * discriminated union at the root is an `anyOf` of its types, or of other unions.
 */
function allowId(type: Document): void {
  if (Array.isArray(type.anyOf)) {
    for (const option of type.anyOf) allowId(option)
  } else if (type.additionalProperties !== undefined && !type.properties._id) {
    type.properties._id = { bsonType: 'objectId' }
  }
}
