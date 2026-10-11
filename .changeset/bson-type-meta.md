---
'mongozod': minor
---

The `$jsonSchema` of `sync()` takes the BSON type a field declares in its Zod metadata, with
`.meta({ bsonType })` or `z.meta()` in Zod Mini, over the one it infers: a field that Zod cannot
describe, such as `z.instanceof(Decimal128).meta({ bsonType: 'decimal' })`, gets its rule instead
of none. On a `.nullable()` it types the value and `null` still passes. mongozod adds `bsonType`
to Zod's `GlobalMeta`, so the editor suggests the BSON type aliases. `objectId()` declares its type
the same way.
