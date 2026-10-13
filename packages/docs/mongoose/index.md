---
title: Migrating from Mongoose
description: Move a Mongoose app to MongoZod one model at a time, on the connection Mongoose already opened, with a prompt for your coding agent.
---

This guide is for teams with an app on Mongoose that want the Zod schema to be the single source of
truth of each document. There is no big switch: MongoZod runs on the connection Mongoose already
opened, so you migrate one model at a time and ship each one, while the rest of the app keeps using
Mongoose.

A model on Mongoose:

```ts nocheck
import { Schema, model } from 'mongoose'

const postSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, default: '' },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    tags: [String],
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
)

postSchema.index({ authorId: 1, createdAt: -1 })

export const Post = model('Post', postSchema)
```

The same model on MongoZod, over the same collection and the same documents:

```ts
import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

// What posts read from `users`, which Mongoose still owns.
const userSchema = z.object({

  _id: mz.objectId(),

  name: z.string()
})

const postSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  title: z.string()
    .trim()
    .min(1),

  body: z.string()
    .default(''),

  status: z.enum(['draft', 'published'])
    .default('draft'),

  tags: z.string()
    .array()
    .default([]),

  authorId: mz.objectId(),

  createdAt: mz.date(),

  updatedAt: mz.date(),

  __v: z.number()
    .int()
    .default(0)
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  indexes: (index) => [
    index({ authorId: 1, createdAt: -1 })
  ],

  references: {

    authorId: {

      collection: 'users',

      schema: userSchema
    }
  },

  timestamps: true
})
```

The schema keeps the names and shapes MongoDB already stores, so no document has to change. The
[cheatsheet](./cheatsheet.md) maps each Mongoose feature to MongoZod, and
[Differences](./differences.md) explains what works another way.
[Why MongoZod](../getting-started/why-mongozod.md) lists the Mongoose issues it solves.

## The plan

1. [Install MongoZod next to Mongoose](#install-next-to-mongoose), with the same driver.
2. [Share Mongoose's connection](#share-the-connection).
3. [Migrate one model](#migrate-one-model): its schema, its model and its call sites.
4. [Verify it](#verify), ship it, and go on with the next model.
5. [Remove Mongoose](#remove-mongoose) when no code uses it.

To hand a model to a coding agent, paste the [prompt](#copy-prompt) at the end of this page, or
install it as a [skill](../getting-started/ai-agents.md).

## Install next to Mongoose

Both libraries have to use the same driver, so that a `Db` from Mongoose is the `Db` MongoZod
expects. MongoZod takes `mongodb` `^6.20.0 || ^7.0.0`: driver 7 is the one of Mongoose 9, and driver
6.20 the one of Mongoose 8.19 and later. Earlier versions of Mongoose 8 depend on an older driver,
so update Mongoose first.

Find the driver Mongoose installed, then install that same version, with `bson` of its major:

```sh
npm ls mongodb
# └─┬ mongoose@9.11.1
#   └── mongodb@7.7.0

npm install mongozod zod mongodb@7.7.0 bson@7
```

With Mongoose 8.19 or later, the driver is a 6.x, such as `mongodb@6.20.0`, with `bson@6`. Run
`npm ls mongodb` again: it should show one version, `deduped` under `mongoose`. See
[Installation](../getting-started/installation.md) for the rest of the requirements.

## Share the connection

Mongoose's connection wraps the driver's: once it is open, `mongoose.connection.db` is the driver's
`Db` ([Mongoose docs](https://mongoosejs.com/docs/api/connection.html#Connection.prototype.db)).
Give MongoZod a function that returns it:

```ts nocheck
import mongoose from 'mongoose'

/** The database of Mongoose's default connection, for the mongozod models. */
export function mongooseDb() {

  const { db } = mongoose.connection

  if (!db) throw new Error('Mongoose is not connected yet')

  return db
}
```

and pass it as `db`, in place of the `db` of the examples:

```ts nocheck
const PostsModel = mongozod({

  collection: 'posts',

  db: mongooseDb,

  schema: postSchema
})
```

A model calls the function on every operation (see [Models](../guides/models.md)), so the modules
that define models can load before `mongoose.connect()` resolves. Until then the function throws,
and so does any operation. It returns the same `Db` on every call, unlike
`mongoose.connection.getClient().db()`, which builds a new one each time.

Both libraries now share the connection pool, and a session started by Mongoose is the driver's, so
it works in the operations of both:

```ts nocheck
await mongoose.connection.transaction(async (session) => {
  await Post.create([{ title: 'Hello, MongoDB', authorId }], { session })
  await CommentsModel.insertOne({ postId, body: 'First!' }, { session })
})
```

Pass `{ session }` to each MongoZod operation, also when Mongoose's `transactionAsyncLocalStorage`
is on: that option sets the session of Mongoose's operations only
([Mongoose docs](https://mongoosejs.com/docs/transactions.html#asynclocalstorage)). See
[Transactions](../guides/transactions.md).

## Migrate one model

Pick a model, migrate it whole, and ship it before the next one. Its Mongoose model can stay
defined until no code uses it.

### 1. Write the Zod schema

Translate the Mongoose schema with the [cheatsheet](./cheatsheet.md). The schema describes the
document as MongoDB stores it, so keep what is there:

- **The collection**: Mongoose names it after the model, lowercased and in plural, unless the schema
  sets `collection` ([Mongoose docs](https://mongoosejs.com/docs/models.html#compiling)): `Post`
  stores in `posts`. MongoZod takes the name as it is.
- **Field names and shapes**: rename nothing while you migrate. A rename is a separate change that
  migrates the documents too.
- **What is optional**: a Mongoose path is optional unless it says `required`, while a Zod key is
  required unless it says `.optional()`. Mongoose arrays default to `[]`
  ([Mongoose docs](https://mongoosejs.com/docs/schematypes.html#arrays)), so they take
  `.default([])`.
- **The `_id`s**: declare the `_id` with `mz.objectId().default(() => new ObjectId())`, and the same
  in each subdocument, which Mongoose gives an `_id`
  ([Mongoose docs](https://mongoosejs.com/docs/subdocs.html)). A replacement drops the keys a
  `z.object` does not declare. See [IDs](../recipes/ids.md).
- **`__v`**: declare it as `z.number().int().default(0)` while Mongoose still writes the
  collection, unless its schema sets `versionKey: false` (see
  [`__v`](./differences.md#__v-and-optimistic-concurrency)).
- **`timestamps`**: declare `createdAt` and `updatedAt` with `mz.date()` and pass `timestamps: true`.
  Both libraries store them with the same names and types (see [Timestamps](../guides/timestamps.md)).

Without a Mongoose schema, such as for a collection another service writes or a field of type
`Mixed`, start from the `$jsonSchema` of the stored documents. MongoDB Compass exports it from the
**Schema** tab: **Analyze Schema**, then **Export Schema** in the MongoDB format
([Compass docs](https://www.mongodb.com/docs/compass/current/schema/export/)). From code,
[`@mongodb-js/mongodb-schema`](https://github.com/mongodb-js/devtools-shared/tree/main/packages/mongodb-schema)
does the same:

```ts nocheck
import { analyzeDocuments } from '@mongodb-js/mongodb-schema'

const sample = db.collection('posts').aggregate([{ $sample: { size: 1000 } }])
const jsonSchema = await (await analyzeDocuments(sample)).getMongoDBJsonSchema()
```

Both read a sample: a field that every sampled document has comes out as required, and the result
has no defaults, no enums and no references. Decide those from the code that writes the collection.

### 2. Define the model

Pass the options that replace the rest of the Mongoose schema: `indexes`, `references`, `virtuals`,
`timestamps` and `plugins`, each in the [cheatsheet](./cheatsheet.md). A reference to a collection
that Mongoose still owns points to the collection and a schema of what you read from it, as
`authorId` does above; once that model is migrated too, point it to the model:
`authorId: () => UsersModel`.

Middleware moves to `.transform()`s of the schema or to the hooks of plugins, as the
[cheatsheet](./cheatsheet.md#middleware) maps it.

### 3. Update the call sites

Find every use of the Mongoose model and rewrite it with the
[cheatsheet](./cheatsheet.md#models-and-operations). TypeScript guides you: most Mongoose habits do
not compile, such as a string `_id` in a filter, an update without operators, or a sort, a
projection or a `populate` in a string. Before:

```ts nocheck
const post = await Post.findById(id).select('title status').lean()

await Post.findByIdAndUpdate(id, { status: 'published' }, { new: true })

const drafts = await Post.find({ authorId, status: 'draft' })
  .sort('-createdAt')
  .limit(20)
  .populate('authorId', 'name')
```

After:

```ts
// The ids of the route, such as req.params.id.
const id = mz.objectId().parse('64f1c2a9e4b0a1b2c3d4e5f6')
const authorId = mz.objectId().parse('64f1c2a9e4b0a1b2c3d4e5f7')

const post = await PostsModel.findOne({ _id: id }, { projection: { title: 1, status: 1 } })

await PostsModel.findOneAndUpdate(
  { _id: id },
  { $set: { status: 'published' } },
  { returnDocument: 'after' }
)

const drafts = await PostsModel.find(
  { authorId, status: 'draft' },
  { sort: { createdAt: -1 }, limit: 20, populate: { authorId: { projection: { name: 1 } } } }
)
```

Code that changed a document and called `save()` writes the change with an operator instead (see
[Differences](./differences.md#no-documents-and-no-save)).

## Verify

Before shipping the model:

- **Types**: `tsc` passes with no new `as` casts or `any`. A cast hides the errors that point at
  Mongoose habits.
- **Tests**: run them against MongoDB, such as with `mongodb-memory-server`, so that the server
  checks what the types cannot.
- **Stored documents**: MongoZod validates writes, not reads, so a document stored before the schema
  existed is read as it is, whatever its type says. Check them all once, through the driver's
  collection, which returns them as stored: the model's `find` computes the virtuals, which throw
  on a document that does not fit.

  ```ts
  const invalid: Array<{ _id: ObjectId; issues: string }> = []

  for await (const stored of PostsModel.collection.find()) {
    const result = postSchema.safeParse(stored)

    if (!result.success) invalid.push({ _id: stored._id, issues: z.prettifyError(result.error) })
  }
  ```

  Use `safeParseAsync` when the schema has async refinements. Fix the schema where it is wrong, and
  the documents where they are (see [Schema migrations](../recipes/schema-migrations.md)).

- **Indexes**: run `sync()` against a development database. It creates the declared indexes that
  are missing, and returns in `extraIndexes` the ones the collection has and the model does not
  declare, such as one you forgot to translate. It never drops an index (see
  [Sync](../guides/sync.md)).

  ```ts
  const { extraIndexes } = await PostsModel.sync()
  ```

## Remove Mongoose

Delete a Mongoose model once no code calls it and no Mongoose schema has a `ref` to it: Mongoose
populates a `ref` with the model of that name
([Mongoose docs](https://mongoosejs.com/docs/populate.html)).

When the last model is gone, open the connection with the driver, give MongoZod its `Db`, and
remove Mongoose:

```ts separate
import { MongoClient } from 'mongodb'

export const client = new MongoClient('mongodb://localhost:27017')
export const db = client.db()
```

Then you can drop `__v` from the schemas (see
[`__v`](./differences.md#__v-and-optimistic-concurrency)), and turn on `jsonSchema` in the models,
so that the server checks every write too (see [Sync](../guides/sync.md)). While Mongoose still
writes a collection, the server would reject its writes that do not fit the schema.

## Copy prompt

Paste this into your coding agent to migrate one model. Fill in the model and its files first.

```text
Migrate the Mongoose model <Model> (<path to its file>) to mongozod, without changing the data
that MongoDB stores. Do this model only.

Read first, from the mongozod docs installed with the package, in node_modules/mongozod/dist/docs/:
README.md, mongoose/index.md, mongoose/cheatsheet.md and mongoose/differences.md, then
guides/schemas.md, guides/models.md, guides/operations.md, guides/validation.md and
guides/security.md, and the guide of each feature the model uses (populate, virtuals, timestamps,
document-types, sync, plugins).
They match the installed version: follow them over what you remember of mongozod or Mongoose.

1. Write the Zod schema of the stored document, with mongoose/cheatsheet.md:
   - Keep every field name, shape and the collection name as stored. Mongoose names the
     collection after the model, lowercased and in plural, unless the schema sets `collection`.
   - A Mongoose path without `required` is `.optional()`. An array is `.default([])`. A required
     String is `.min(1)`.
   - Declare the `_id` as `mz.objectId().default(() => new ObjectId())`, and the same in each
     subdocument, unless it has `_id: false`.
   - Declare `__v: z.number().int().default(0)` while Mongoose still writes the collection,
     unless the Mongoose schema sets `versionKey: false`.
   - With `timestamps`, declare `createdAt` and `updatedAt` as `mz.date()`.
   If the collection has no Mongoose schema, start from its $jsonSchema: <path to the file
   exported from MongoDB Compass or @mongodb-js/mongodb-schema>. It comes from a sample, so
   decide from the code that writes the collection which fields are required, which values an
   enum takes, the defaults and which fields store the _id of another document.

2. Define the model with mongozod() on Mongoose's connection, with `db: mongooseDb` from
   <path to the module of mongooseDb, or create it as mongoose/index.md shows>. Translate the
   indexes, refs, virtuals, timestamps and plugins with the cheatsheet. A ref to a collection
   that is still on Mongoose is a reference to `{ collection, schema }`. A pre('save') that changes
   a field is a .transform() of that field; other middleware is a hook of a plugin.

3. Find every call site of <Model> and rewrite it with the cheatsheet and mongoose/differences.md:
   explicit operations instead of documents and save(), updates with operators, ObjectIds instead
   of strings in filters (parse them with mz.objectId() or take them through mz.filter), and the
   projection, sort and populate as objects in the options. Keep the Mongoose model if other code
   still uses it or another Mongoose schema has a ref to it.

4. Keep the security of each call site, with guides/security.md. mongozod doesn't sanitize or
   cast filters at runtime, and a request body is typed `any`, so tsc doesn't catch it:
   - Parse the input of each endpoint once, before the model: .pick() of the model's schema for
     values, the mz builders (mz.filter, mz.update, mz.projection…) for MongoDB syntax from the
     client, and mz.objectId() for an id. Check whether the project used sanitizeFilter,
     strictQuery or mongoose.trusted().
   - Never pass req.body or req.query whole as a filter, an update or a document to insert.
   - Keep every owner or tenant condition, joined with the client's filter with $and, never with
     a spread.
   - A query that becomes an aggregate skips the plugins, such as soft delete: keep their
     conditions in its $match. Exclude each select: false field in every read of the model.

5. Check, and fix what fails:
   - tsc passes, with no `as` casts, `any`, @ts-ignore or @ts-expect-error added to make it
     compile.
   - The tests pass against MongoDB.
   - Write a script, which I will run, that reads every stored document through the model's
     `collection`, as mongoose/index.md shows, and reports the ones that fail `schema.safeParse()`.
   - Run sync() only against a development database, and report its extraIndexes.

6. Report the files you changed, every decision the Mongoose schema left open, what mongozod
   does not have yet that the model used, as listed in mongoose/differences.md, and each call
   site that takes data from a request, with how its input is parsed now.
```

## Common mistakes

- **Two copies of the driver**: a `mongodb` version other than Mongoose's installs a second copy,
  and passing Mongoose's `Db` to MongoZod fails with TS2322, _Types have separate declarations of a
  private property_. Install the version `npm ls mongodb` shows under `mongoose`.
- **Reading `mongoose.connection.db` when a module loads**: it is `undefined` until the connection
  opens. Pass the function, `db: mongooseDb`, not its result.
- **Relying on `transactionAsyncLocalStorage`**: a MongoZod operation without `{ session }` runs
  outside the transaction, and an abort does not undo it. Pass the session to each one.
- **Another collection name**: `collection: 'post'` for a model named `Post` reads an empty
  collection, without an error. Check the name Mongoose used, `posts` here.
- **Leaving `__v` or the `_id` of subdocuments out of the schema**: a `replaceOne` or
  `findOneAndReplace` removes from the stored document what the schema does not declare. Declare
  both while Mongoose shares the collection.
- **Turning on `jsonSchema` while Mongoose writes the collection**: the server applies the validator
  to every write, so Mongoose's writes that do not fit the schema fail. Turn it on once MongoZod is
  the only writer (see [Sync](../guides/sync.md)).
