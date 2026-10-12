---
title: BSON types
description: Store ObjectId, Decimal128, binary data, UUIDs, dates, sets and GeoJSON, and take them as JSON from clients.
---

MongoDB stores BSON, which has types that JSON lacks, such as `ObjectId`, `Decimal128` and dates. The
field types of `mongozod/mzod` go in a document's schema: each one takes what a JSON client sends
and what your server passes, and returns the BSON value the driver stores and reads back.

```ts
import { Decimal128, ObjectId, UUID } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const postSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  title: z.string()
    .min(1),

  authorId: mz.objectId(),

  tags: mz.set(z.string())
    .default([]),

  publishedAt: mz.date()
    .optional()
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema
})

// The strings of a JSON request body
const { document: post } = await PostsModel.insertOne({
  title: 'Hello, MongoDB',
  authorId: '65c3b9b4f1d2a34b5c6d7e8f',
  publishedAt: '2026-10-12T09:00:00Z'
})
// { _id: ObjectId('…'), title: 'Hello, MongoDB', authorId: ObjectId('65c3b9b4f1d2a34b5c6d7e8f'),
//   tags: [], publishedAt: 2026-10-12T09:00:00.000Z }
```

The same field types parse the values of the [endpoint inputs](./endpoint-inputs.md), so the hex
string of a filter by `authorId` reaches the model as an `ObjectId`.

## The field types

| Field type                               | A JSON client sends                                                       | The server passes                        | Stored and read as                |
| ---------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------- |
| `mz.objectId()`                          | its 24-character hex string                                               | an `ObjectId`                            | an `ObjectId`                     |
| `mz.decimal128()`                        | a string such as `"10.50"`, an exact number, or `{ "$numberDecimal": … }` | a `Decimal128`                           | a `Decimal128`                    |
| `mz.binary()`                            | the base64 string of its bytes                                            | a `Uint8Array`, a `Buffer` or a `Binary` | a `Binary`                        |
| `mz.uuid()`                              | its string, with hyphens                                                  | a `UUID`                                 | a `UUID`, a `Binary` of subtype 4 |
| `mz.date()`                              | an ISO datetime string with `Z` or an offset                              | a `Date`                                 | a `Date`                          |
| `mz.set(item)`                           | an array without repeated values                                          | an array                                 | an array                          |
| `mz.point()` and the other GeoJSON types | a GeoJSON object                                                          | the same                                 | the same object                   |

Each one returns the type that reads return. Reads are not parsed: the driver gives back its own
BSON values, so the output of the schema has to match them. That is why `mz.binary()` returns a
`Binary` and not a `Uint8Array`, and `mz.set()` returns an array and not a `Set`.

A value that doesn't fit gives one issue, with a message that says what the field takes, such as
`Invalid ObjectId: expected an ObjectId or its 24-character hex string`. A missing value adds
`, received undefined`, as Zod says of any missing field.

## Where they run

`mongozod/mzod` never imports the driver, so a schema that uses it also runs in web and React Native
clients, such as one shared between a form and its endpoint. The BSON types come from
[`bson`](https://www.npmjs.com/package/bson), a peer dependency of mongozod of the same major as your
driver (see [Installation](../getting-started/installation.md)). A bundler leaves `bson` out unless a
field needs it: `mz.date()` and the GeoJSON types import only Zod.

A schema shared with a client imports `ObjectId`, `Decimal128` or `UUID` from `bson`, since the
client cannot import the driver. Server code can import them from `mongodb`, which re-exports
`bson`'s.

## ObjectId

`mz.objectId()` takes an `ObjectId` or its 24-character hex string, in lowercase or uppercase, and
returns an `ObjectId`. Give the `_id` a default to generate it, as in the example above. See
[Schemas](./schemas.md) for the other forms of the `_id`.

A route parameter is a string, so parse it with the field type before you query:

```ts
const authorId = mz.objectId().parse('65c3b9b4f1d2a34b5c6d7e8f')

const byAuthor = await PostsModel.find({ authorId })

post.authorId.equals(authorId) // true
```

Compare two ids with `.equals()` and check a value with `ObjectId.isValid()`, never with
`instanceof`. In an ES module app, the driver reads values with the CommonJS build of `bson`, and
what your code builds may come from its ES module build: they are two classes, so `instanceof` fails
with half of the values. `mz.objectId()` recognizes both. The same goes for `Decimal128` and `UUID`.

## Decimal128

`mz.decimal128()` is the type for money. It takes a `Decimal128`, its string, such as `'10.50'`, or
a number, and returns a `Decimal128`:

```ts
const invoiceSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  total: mz.decimal128()
})

const InvoicesModel = mongozod({

  collection: 'invoices',

  db,

  schema: invoiceSchema
})

const { document: invoice } = await InvoicesModel.insertOne({ total: '10.50' })

// $inc and $mul parse the amount with the field, so the sum stays exact
await InvoicesModel.updateOne({ _id: invoice._id }, { $inc: { total: '0.10' } })
// total: Decimal128('10.60')
```

- **Numbers**: a number passes when it is the decimal it was written as, with up to 15 significant
  digits, such as `10.5` or `19.99 * 3`. One with more digits, such as the `0.30000000000000004` of
  `0.1 + 0.2`, fails and asks for the string: storing it would change the amount without a word.
- **Strings**: they go through `Decimal128.fromString()`, so a string that is not a decimal fails,
  and so does one that `bson` would round, with more than 34 digits.
- **`NaN` and `Infinity`** fail in every form, since an amount is a number.
- **JSON**: `JSON.stringify` writes a `Decimal128` as `{ "$numberDecimal": "10.50" }`, and
  `mz.decimal128()` takes that form too, so a document your endpoint returned comes back as it was.
- **`$inc` and `$mul`** leave out the field's checks, such as a `.refine()` that keeps a balance at
  zero or above: they validate the value, not what changes it.

A filter on a decimal takes a `Decimal128`, not a number. A double is not always the decimal that
was written, and MongoDB compares them by value: a filter with the number `9.99` can leave out a
stored `9.99`.

```ts
const large = await InvoicesModel.find({ total: { $gte: Decimal128.fromString('100') } })

// @ts-expect-error: a filter on a Decimal128 takes a Decimal128
await InvoicesModel.find({ total: { $gte: 100 } })
```

What a client sends goes through `mz.filter`, which converts its strings. See
[Dates and money](../recipes/dates-and-money.md) for more.

## Binary data

`mz.binary()` takes the base64 string of the bytes, which a JSON client sends, a `Uint8Array` or a
`Buffer`, which your server passes, or a `Binary`, and returns a `Binary`, the type the driver reads
binary data as:

```ts
const attachmentSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  postId: mz.objectId(),

  name: z.string(),

  data: mz.binary()
})

const AttachmentsModel = mongozod({

  collection: 'attachments',

  db,

  schema: attachmentSchema
})

const { document: attachment } = await AttachmentsModel.insertOne({
  postId: post._id,
  name: 'hello.txt',
  data: 'aGVsbG8='
})

attachment.data.value() // the bytes: 104, 101, 108, 108, 111
attachment.data.toString('base64') // 'aGVsbG8='
```

A `Binary` keeps its subtype, and a `UUID` stays a `UUID`. Bytes and base64 become a generic
`Binary`, subtype 0, as the driver stores bytes.

## UUID

`mz.uuid()` stores a UUID as a `Binary` of subtype 4, which takes 16 bytes where its string takes 36.
It takes the string of a UUID, with hyphens and in lowercase or uppercase, or a `UUID`, and returns
a `UUID`, which is what the driver reads:

```ts
const sessionSchema = z.object({

  _id: mz.uuid()
    .default(() => new UUID()),

  userId: mz.objectId(),

  expiresAt: mz.date()
})

const SessionsModel = mongozod({

  collection: 'sessions',

  db,

  schema: sessionSchema
})

const session = await SessionsModel.findOne({
  _id: mz.uuid().parse('0f1aef5a-e7a8-4f60-811b-6685550d99ff')
})
```

A string without hyphens fails, although `bson` takes it, because it is not the form a client sends.
A `Binary` of subtype 4 becomes a `UUID`, and one of another subtype fails.

## Dates

`mz.date()` takes a `Date` or an ISO datetime string with `Z` or an offset, such as
`'2026-10-12T09:00:00Z'` or `'2026-10-12T06:00:00-03:00'`, and returns a `Date`. A string without
either fails, because it doesn't say which instant it is. It is the
[`isoDatetimeToDate`](https://zod.dev/codecs#isodatetimetodate) codec of the Zod docs, taking an
offset too, in a union that also takes a `Date`.

Use it for every date a client may send, such as `publishedAt` above, and for `createdAt` and
`updatedAt` with [timestamps](./timestamps.md). A plain `z.date()` rejects the ISO string that JSON
gives.

## Sets

`mz.set(item)` is an array that keeps each value once, the array of `$addToSet`. A repeated value
fails with a `ZodError` at its index: the value is not removed for you.

```ts
await PostsModel.updateOne(
  { _id: post._id },
  { $addToSet: { tags: { $each: ['mongodb', 'zod'] } } }
)

// @ts-expect-error: "tags" is a set: use $addToSet
await PostsModel.updateOne({ _id: post._id }, { $push: { tags: 'zod' } })
```

- **Equality**: the one of the `uniqueItems` of MongoDB's `$jsonSchema`. Numbers compare by value
  (`1` and `1.0`), BSON values by theirs (two copies of an `ObjectId`), dates by their instant and
  objects by their fields in any order. The elements are parsed first, so a hex string and the
  `ObjectId` it decodes to are the same value.
- **Updates**: only `$addToSet` adds. `$push`, and writing an element by its index or a positional
  operator, such as `tags.0` or `tags.$[]`, don't compile and throw a `ZodError`. A `$set` of the
  whole array is parsed, and `$pull`, `$pullAll` and `$pop` remove.
- **On the server**: with the [`jsonSchema` option](./sync.md), `sync()` marks the array with
  `uniqueItems: true`, so MongoDB also rejects a repeated value that arrives some other way, such as
  a `$push` through the driver. Without it, there is one case mongozod doesn't see: `$addToSet`
  compares objects with the order of their fields, so it adds an equal object with its fields in
  another order.

It returns an array, not a `Set`, because the driver reads arrays. A `z.set()` in a model's schema
throws an `Error` when the model is defined: the driver would store it as `{}`.

## GeoJSON

`mz.point()`, `mz.lineString()`, `mz.polygon()`, `mz.multiPoint()`, `mz.multiLineString()`,
`mz.multiPolygon()` and `mz.geometryCollection()` are Zod schemas of the GeoJSON objects MongoDB
stores and queries. They don't convert values: they validate the shape.

```ts
const placeSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  name: z.string(),

  location: mz.point(),

  area: mz.polygon()
    .optional()
})

const PlacesModel = mongozod({

  collection: 'places',

  db,

  schema: placeSchema,

  indexes: (index) => [
    index({ location: '2dsphere' })
  ]
})

await PlacesModel.sync()

await PlacesModel.insertOne({
  name: 'Obelisco',
  location: { type: 'Point', coordinates: [-58.3816, -34.6037] }
})

const nearby = await PlacesModel.find({
  location: {
    $near: {
      $geometry: { type: 'Point', coordinates: [-58.38, -34.6] },
      $maxDistance: 1000
    }
  }
})
```

They check what MongoDB rejects with a `2dsphere` index, and stores as it is without one:

- **Positions**: `[longitude, latitude]`, in that order and in their ranges, from -180 to 180 and
  from -90 to 90, with an optional altitude.
- **Lines**: two different positions at least.
- **Polygons**: closed rings, whose last position repeats the first, with four positions at least.
- **Multi geometries and collections**: not empty. A `GeometryCollection` holds the other types,
  never another collection.

Whether a ring crosses itself, or a hole lies inside the exterior ring, the `2dsphere` index checks.
A query such as `$near` needs that index: declare it in `indexes` and run [`sync()`](./sync.md).

## Back to JSON

`z.encode` turns a document into what a client sends: an `ObjectId` into its hex string, a
`Decimal128` and a `UUID` into their strings, a `Binary` into base64 and a `Date` into an ISO string
in UTC.

```ts
const sent = z.encode(postSchema, post)
// { _id: '6a0…', title: 'Hello, MongoDB', authorId: '65c3b9b4f1d2a34b5c6d7e8f', tags: [],
//   publishedAt: '2026-10-12T09:00:00.000Z' }
```

`JSON.stringify`, which `res.json()` uses, gives the same strings, except for a `Decimal128`, which
it writes as `{ "$numberDecimal": "10.50" }`. `mz.decimal128()` takes both, so a document your endpoint
returns can come back in a request either way.

## Fields without a codec

`sync()` can apply a [`$jsonSchema`](./sync.md) generated from the schema, with the BSON type of each
field. A field that Zod doesn't describe, such as a `z.custom()` or a `z.instanceof()`, gets no rule.
Declare its type with Zod's metadata API, `.meta({ bsonType })`:

```ts
const ledgerSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  balance: z.instanceof(Decimal128)
    .meta({ bsonType: 'decimal' }),

  entries: z.number()
    .int()
    .min(0)
    .max(2_147_483_647)
    .meta({ bsonType: 'int' })
})
```

- **It replaces the inferred type**, so it also narrows a `number` to an `int`. The driver writes a
  number as an `int` only when it is an integer that fits in 32 bits: with `int`, the server rejects
  a larger one.
- **The field types use it**: `mz.objectId()` is an `objectId`, `mz.decimal128()` a `decimal`,
  `mz.binary()` and `mz.uuid()` are `binData`, and `mz.date()` a `date`.
- **With `.nullable()`**, it is the type of the value, and `null` still passes, so `.meta()` goes
  before or after `.nullable()` alike. A later `.min()` or `.refine()` keeps it, as Zod keeps any
  metadata.
- **Typed**: mongozod adds `bsonType` to Zod's `GlobalMeta`, so the editor suggests MongoDB's
  aliases and a misspelled one doesn't compile. It takes one alias: a field of several types is a
  `z.union`.
- **Zod Mini** declares it with its `z.meta()` check, as in
  `z.custom<Decimal128>().check(z.meta({ bsonType: 'decimal' }))`.

## Common mistakes

- **Checking ids with `instanceof ObjectId`**: it fails for the values of the other build of `bson`,
  without an error. Use `.equals()` and `ObjectId.isValid()`.
- **Filtering by a hex string by hand**: the model doesn't cast filters, so `{ authorId: '65c3…' }`
  doesn't compile. Pass an `ObjectId`, or parse the client's value with `mz.objectId()` or
  [`mz.filter`](./endpoint-inputs.md).
- **Using `z.date()` for a date a client sends**: it rejects the ISO string of JSON, in writes and in
  `mz` inputs. Use `mz.date()`. An ISO string without `Z` or an offset fails too: send the offset.
- **Comparing a decimal with a number**: it doesn't compile, and MongoDB could leave out the stored
  amount. Use `Decimal128.fromString('9.99')`, or the client's string through `mz.filter`.
- **Sending amounts as numbers from a client**: `0.1 + 0.2` fails with `send it as a string`, and so
  does a number that `JSON.parse` already rounded. Send amounts as strings.
- **Using `z.set()` or `$push` on a set**: the model throws an `Error` at definition for `z.set()`,
  and a `$push` doesn't compile. Use `mz.set()` and `$addToSet`.
- **Writing `[latitude, longitude]`**: GeoJSON takes the longitude first. `mz.point()` only catches
  the swap when the latitude falls outside -90 to 90.
- **Expecting a `Uint8Array` from a binary field**: reads return a `Binary`. Its `value()` gives
  the bytes.
