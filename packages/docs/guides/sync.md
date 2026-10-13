---
title: Sync
description: Create the indexes a model declares and apply a $jsonSchema validator generated from its schema, with sync().
---

`sync()` prepares a model's collection on the server: it creates the indexes the model declares
and, when the model asks for it, applies a `$jsonSchema` validator generated from the schema. It
never runs on its own. Call it when you deploy, from a script or when the app starts, not on each
operation.

```ts
import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const postSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  title: z.string()
    .min(1),

  slug: z.string(),

  body: z.string()
    .default(''),

  status: z.enum(['draft', 'published'])
    .default('draft'),

  tags: mz.set(z.string())
    .default([]),

  authorId: mz.objectId(),

  createdAt: mz.date(),

  updatedAt: mz.date()
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  timestamps: true,

  indexes: (index) => [
    index({ status: 1, createdAt: -1 }),
    index({ slug: 1 }, { unique: true, partialFilterExpression: { status: 'published' } }),
    index({ title: 'text', body: 'text' }, { weights: { title: 10 } })
  ],

  jsonSchema: true
})

const { indexes, extraIndexes } = await PostsModel.sync()
// indexes: ['status_1_createdAt_-1', 'slug_1', 'title_text_body_text']
// extraIndexes: []
```

Running it again changes nothing: the indexes that exist stay as they are.

## Indexes

`indexes` is a callback that declares each index with `index(key, options)`, like the driver's
`createIndex(key, options)`. It is a callback so that the editor suggests the paths of the
document while you type them.

- **Keys** are paths of the document, dotted and through arrays as in a filter, or the wildcards
  `$**` and `path.$**`. They take the driver's values: `1`, `-1`, `'text'`, `'2dsphere'` and the
  rest.
- **Options** are the driver's `IndexDescription`: `unique`, `name`, `partialFilterExpression`,
  `expireAfterSeconds`, `collation`, `weights` and the rest.
- **`partialFilterExpression`** is checked like a filter of the model, and the keys of `weights`
  are paths of the document, or `$**`. In the example above, the slug of a published post is
  unique, and drafts may share one.

```ts
const sessionSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  userId: mz.objectId(),

  expiresAt: mz.date()
})

const SessionsModel = mongozod({

  collection: 'sessions',

  db,

  schema: sessionSchema,

  indexes: (index) => [
    // MongoDB deletes each session after its expiresAt
    index({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    index({ userId: 1 })
  ]
})
```

A key or a weight that is not a path doesn't compile, and throws an `Error` when the model is
defined:

```ts
mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  // @ts-expect-error: "titel" is not a path of the document
  indexes: (index) => [index({ titel: 1 })]
})
// Error: index key "titel" is not a path of the document
```

Some mistakes reach the server or pass unnoticed:

- **An index without keys**, `index({})`, compiles, and throws an `Error` when the model is defined.
- **An operator that a partial index doesn't take**, such as `$ne`, compiles: the server rejects it
  when `sync()` runs, with the code 67.
- **`expireAfterSeconds` on a field that is not a date** compiles, and MongoDB takes it, but deletes
  nothing.

## What `sync()` returns

`sync()` returns `{ indexes, extraIndexes }`:

- **`indexes`**: the names of the declared indexes, created now or already there.
- **`extraIndexes`**: the indexes of the collection that the model doesn't declare, as the driver
  describes them, with their `name` and `key`. The index of `_id` is not among them, nor the one
  MongoDB creates on the `metaField` and `timeField` of a time-series collection.

MongoZod doesn't write to the console. Your script decides what to do with the extra indexes:

```ts
for (const index of extraIndexes) {
  console.warn(`posts has an index the model doesn't declare: ${index.name}`)
}
```

## It never drops an index

`sync()` never drops an index, unlike Mongoose's
[`syncIndexes()`](https://mongoosejs.com/docs/api/model.html), which drops the indexes its schema
doesn't define. When an index of the collection differs from a declared one, `sync()` fails with
the server's error, which names the index: the code 85 when the same keys have another name, and 86
when the same name has other options. MongoDB creates the indexes of one call all or none, so none
is created.

To change an index, drop it with the driver and run `sync()` again:

```ts
await PostsModel.collection.dropIndex('slug_1')
await PostsModel.sync()
```

An index with another name and other options is created next to the old one, which stays among
`extraIndexes`.

## `$jsonSchema`

Writes through the model are validated by Zod. The `jsonSchema` option makes the server check the
structure of each document too, so what the model can't see is checked as well: writes through the
driver or other apps, and a dotted `$set` that creates a parent without its required fields.

- **`jsonSchema: true`** applies the validator with MongoDB's defaults, `validationLevel: 'strict'`
  and `validationAction: 'error'`.
- **An object** sets them: `{ validationLevel: 'moderate' }` doesn't validate the updates of
  documents that already fail, for a collection with old documents, and
  `{ validationAction: 'warn' }` logs instead of rejecting. See
  [validation levels](https://www.mongodb.com/docs/manual/core/schema-validation/specify-validation-level/).
- **Applied with `collMod`**, or when `sync()` creates the collection. It replaces the validator the
  collection had, one set by hand included. Without the option, `sync()` leaves the validator
  alone.
- **Needs `dbAdmin`**: `collMod` is an action of that role, not of `readWrite`, which covers the
  indexes. Run `sync()` from a deploy step with a user that has it, and keep the application's user
  at `readWrite` (see [The user](../getting-started/connection.md#the-user)).

A write that fails the validator fails with the server's error, code 121:

```ts
await db.collection('posts').insertOne({ title: 'Hello', status: 'archived' })
// MongoServerError: Document failed validation (code 121)
```

### What it checks

The validator follows the output of the schema, which is what the database stores: the end of a
pipe or a codec.

- **Types**: the BSON type of each field, nested objects and arrays, enums and literals, `null` and
  unions, as an `anyOf`.
- **Required fields**: those the output always has, including the ones with a default.
- **Field types**: `mz.objectId()` is an `objectId`, `mz.date()` a `date`, and `mz.set()` an array
  with `uniqueItems: true`, so the server also rejects a repeated value. A field that Zod doesn't
  describe declares its type with [`.meta({ bsonType })`](./bson-types.md#fields-without-a-codec).
- **Extra fields**: a `z.object` leaves `additionalProperties` open. It drops the keys it doesn't
  declare on each write, but the stored documents may have them. A `z.strictObject` closes it, and a
  `.catchall()` checks them with its schema. Either way, when the schema doesn't declare `_id`, the
  validator does, as an `objectId`, so the `_id` the driver generates passes.

Part of the validator of the `postSchema` above:

```json
{
  "bsonType": "object",
  "properties": {
    "_id": { "bsonType": "objectId" },
    "title": { "bsonType": "string" },
    "status": { "enum": ["draft", "published"] },
    "tags": { "bsonType": "array", "items": { "bsonType": "string" }, "uniqueItems": true },
    "createdAt": { "bsonType": "date" }
  },
  "required": [
    "_id",
    "title",
    "slug",
    "body",
    "status",
    "tags",
    "authorId",
    "createdAt",
    "updatedAt"
  ]
}
```

Some things stay in the app:

- **Refinements**, such as `.min(1)` or `.email()`: the validator checks types and structure.
- **Transforms, `z.custom()` and `z.unknown()`**: their fields get no rule, unless they declare a
  `bsonType`.
- **Recursive schemas**: the field through which the schema refers to itself gets no rule, because
  `$jsonSchema` has no `$ref`.

MongoZod writes the validator itself instead of using `z.toJSONSchema()`: MongoDB's `$jsonSchema`
is [draft 4 without `$ref`, `default`, `format` or the `integer` type](https://www.mongodb.com/docs/manual/reference/operator/query/jsonSchema/),
rejects unknown keywords, and uses `bsonType` for dates and the other BSON types.

## Where it runs

- **Time-series and capped collections**, and a default collation, are created with the driver,
  with `db.createCollection()`, before `sync()`.
- **A model whose `db` is a function** syncs the database the function returns at that moment, so
  a project with a database per tenant runs `sync()` for each one. See
  [Multi-tenant](../recipes/multi-tenant.md).

## Common mistakes

- **Never calling `sync()`**: the model works, but a `unique` index doesn't exist, so duplicates get
  in, and queries scan the collection. Run it on each deploy.
- **Running `sync()` with `jsonSchema` as the application's user**: `collMod` fails with the code
  13, `Unauthorized`, unless the user has `dbAdmin`. Give it to the user of the deploy step only.
- **Changing the options of an existing index**: `sync()` fails with the code 85 or 86. Drop the
  index with `model.collection.dropIndex()` first.
- **Expecting `sync()` to drop the indexes you removed**: they stay, listed in `extraIndexes`.
- **Expecting the server to check refinements**: `.min()`, `.email()` and `.refine()` run only in
  the app.
- **Turning on `jsonSchema: true` over old documents**: with `strict`, an update of a document that
  doesn't pass fails. Use `{ validationLevel: 'moderate' }` while you migrate them. See
  [Schema migrations](../recipes/schema-migrations.md).
- **Using an operator that partial indexes don't take, such as `$ne`, in a
  `partialFilterExpression`**: it compiles, and the server rejects the index with the code 67.
