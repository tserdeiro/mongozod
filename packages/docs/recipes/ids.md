---
title: IDs
description: Choose how the _id of each document is generated, compare ObjectIds, and add the id virtual that Mongoose had.
---

Every document has an `_id`. The schema decides what it stores and who generates it: the driver,
when the schema leaves it out, or the schema's own `.default()`.

```ts
import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import { z } from 'zod'

// Not declared: the driver generates an ObjectId.
const tagSchema = z.object({ name: z.string() })

// An ObjectId that the schema generates.
const postSchema = z.object({
  _id: mz.objectId().default(() => new ObjectId()),
  title: z.string(),
  authorId: mz.objectId()
})

// A UUID string that the schema generates.
const sessionSchema = z.object({
  _id: z.uuidv4().default(() => crypto.randomUUID()),
  userId: mz.objectId(),
  expiresAt: mz.date()
})
```

## Leave it out

Without an `_id` in the schema, the driver adds an `ObjectId` to each document it inserts. Reads
type the `_id` as an `ObjectId`, filters take one, and `insertOne` returns it in `insertedId` and
in `document`:

```ts
const TagsModel = mongozod({ collection: 'tags', db, schema: tagSchema })

const { document: tag } = await TagsModel.insertOne({ name: 'mongodb' })
// { _id: ObjectId('…'), name: 'mongodb' }
```

What is built from the schema doesn't know about it, though:
`mz.filter(tagSchema, { _id: ['$eq'] })` doesn't compile, and `z.encode` leaves the `_id` out, as a
`z.object` does with any key it doesn't declare. Declare the `_id` when an endpoint takes it or
returns it.

## An ObjectId from the schema

`mz.objectId()` stores an `ObjectId` and also takes its 24-character hex string, which is what a
JSON client sends. Its `.default()` generates one for each insert, so inserts don't ask for it:

```ts
const PostsModel = mongozod({ collection: 'posts', db, schema: postSchema })

const { document: post } = await PostsModel.insertOne({
  title: 'Hello, MongoDB',
  authorId: '64f1c2a9e4b0a1b2c3d4e5f6'
})
// { _id: ObjectId('…'), title: 'Hello, MongoDB', authorId: ObjectId('64f1c2a9e4b0a1b2c3d4e5f6') }
```

Without the `.default()`, every insert has to give the `_id`. An upsert that inserts a document
also gets it from the default, and a replacement keeps the `_id` of the document it replaces. See
[BSON types](../guides/bson-types.md) for what `mz.objectId()` takes.

Import `ObjectId` from `mongodb` on the server. A schema shared with a browser can import it from
`bson`, the package `mongozod/mzod` builds its values with, so it doesn't load the driver.

## A UUID

`z.uuidv4()` stores the `_id` as a string of 36 characters, and `crypto.randomUUID()`, the Web
Crypto global of Node.js and browsers, generates it:

```ts
const SessionsModel = mongozod({ collection: 'sessions', db, schema: sessionSchema })

const { insertedId } = await SessionsModel.insertOne({
  userId: post.authorId,
  expiresAt: new Date(Date.now() + 86_400_000)
})
// insertedId: string, such as '0f6b4c4e-6a8e-4f0e-9a52-2b7d1f0b8c3a'
```

To store it as BSON binary, in 16 bytes, use `mz.uuid()`, also in
[BSON types](../guides/bson-types.md). Define the `_id` field once and reuse it in each schema, so
every collection generates it the same way.

## Compare ObjectIds with `.equals()`

Two `ObjectId`s with the same value are still two objects, so `===` is `false`. Compare them with
`.equals()`, which also takes the hex string:

```ts
const authorId = mz.objectId().parse('64f1c2a9e4b0a1b2c3d4e5f6')
const posts = await PostsModel.find({ authorId })

for (const found of posts) {
  found.authorId.equals(authorId) // true
  found.authorId.equals('64f1c2a9e4b0a1b2c3d4e5f6') // true
  found.authorId === authorId // false: two objects
}
```

Don't check them with `instanceof` either. `bson` ships a CommonJS build and an ES module build,
and an ES module app gets both: the driver loads the CommonJS one and reads every `ObjectId` with
it, while `mz.objectId()` and an `ObjectId` imported from `bson` come from the ES module one. Above,
`found.authorId instanceof ObjectId` is `true` and `authorId instanceof ObjectId` is `false`. The
same goes for `Decimal128` and `UUID`.

`.equals()` compares the values, whatever build each one comes from, and `ObjectId.isValid()`
checks a value that may be an `ObjectId` of either build or its hex string. Filters and writes take
either build: the driver recognizes them by their `_bsontype`, as `mz.objectId()` does.

## The `id` virtual

Mongoose adds an `id` getter to every schema, with the `_id` as a string
([Mongoose docs](https://mongoosejs.com/docs/guide.html#id)). mongozod adds nothing on its own:
declare it as a [virtual](../guides/virtuals.md) that picks the `_id`:

```ts separate
import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import { z } from 'zod'

const userSchema = z.object({
  _id: mz.objectId().default(() => new ObjectId()),
  name: z.string()
})

const UsersModel = mongozod({
  collection: 'users',
  db,
  schema: userSchema,
  virtuals: {
    id: userSchema.pick({ _id: true }).transform((user) => user._id.toHexString())
  }
})

const users = await UsersModel.find()
// [{ _id: ObjectId('6acd…'), name: 'Ana', id: '6acd…' }]
```

Reads that return documents compute it, and it isn't stored, so a filter uses the `_id`. When the
schema doesn't declare the `_id`, the virtual declares it in its own object:
`z.object({ _id: mz.objectId() }).transform(…)`.

You may not need it for a JSON response: `JSON.stringify` already turns each `ObjectId` into its hex
string.

## Common mistakes

- **Comparing with `===` or `instanceof`**: `===` is `false` for two `ObjectId`s with the same
  value, and in an ES module app `instanceof` fails for the ones of the other build of `bson`. Use
  `.equals()`.
- **Filtering by the hex string**: `{ _id: '64f1…' }` on an `ObjectId` field doesn't compile, and
  without types it matches nothing, because mongozod doesn't cast filters. Parse the string with
  `mz.objectId()`, or take the filter through [`mz.filter`](../guides/endpoint-inputs.md).
- **`mz.objectId()` without `.default()` on the `_id`**: every insert has to pass the `_id`, and one
  that doesn't fails with a `ZodError` (`received undefined`). Add `.default(() => new ObjectId())`,
  or leave the `_id` out of the schema.
