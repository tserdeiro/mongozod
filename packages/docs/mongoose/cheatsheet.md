---
title: Mongoose cheatsheet
description: Each Mongoose feature with its mongozod equivalent, from schema types and options to queries, populate, middleware and indexes.
---

Each Mongoose feature and what replaces it in mongozod. The schema is a Zod schema of the document
as MongoDB stores it, and the model has the driver's operations. A Mongoose schema:

```ts nocheck
import { Schema, model } from 'mongoose'

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, match: /^\S+@\S+$/ },
    role: { type: String, enum: ['reader', 'author', 'admin'], default: 'reader' },
    age: { type: Number, min: 13 },
    avatar: Buffer,
    links: { type: Map, of: String },
    addresses: [{ city: String, zip: String }]
  },
  { timestamps: true }
)

userSchema.index({ email: 1 }, { unique: true })

export const User = model('User', userSchema)
```

The same in mongozod:

```ts
import { ObjectId } from 'mongodb'
import { definePlugin, mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const userSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  name: z.string()
    .trim()
    .min(1),

  email: z.string()
    .toLowerCase()
    .regex(/^\S+@\S+$/),

  role: z.enum(['reader', 'author', 'admin'])
    .default('reader'),

  age: z.number()
    .min(13)
    .optional(),

  avatar: mz.binary()
    .optional(),

  links: z.record(z.string(), z.string())
    .optional(),

  addresses: z.object({

    _id: mz.objectId()
      .default(() => new ObjectId()),

    city: z.string()
      .optional(),

    zip: z.string()
      .optional()
  })
    .array()
    .default([]),

  createdAt: mz.date(),

  updatedAt: mz.date()
})

const UsersModel = mongozod({

  collection: 'users',

  db,

  schema: userSchema,

  indexes: (index) => [
    index({ email: 1 }, { unique: true })
  ],

  timestamps: true
})
```

The rest of the page also uses posts and their comments:

```ts
const postSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  title: z.string()
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

  updatedAt: mz.date()
})

const commentSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  postId: mz.objectId(),

  body: z.string()
    .min(1),

  createdAt: mz.date(),

  updatedAt: mz.date()
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  references: {

    authorId: () => UsersModel,

    comments: {

      model: () => CommentsModel,

      foreignField: 'postId'
    }
  },

  timestamps: true
})

const CommentsModel = mongozod({

  collection: 'comments',

  db,

  schema: commentSchema,

  references: {

    postId: () => PostsModel
  },

  timestamps: true
})
```

## Schema types

From [SchemaTypes](https://mongoosejs.com/docs/schematypes.html) in the Mongoose docs:

| Mongoose                                                       | mongozod                                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `new Schema({ … })`                                            | `z.object({ … })`                                                                                                        |
| `String`                                                       | `z.string()`                                                                                                             |
| `Number`                                                       | `z.number()`, or `z.int()` for integers                                                                                  |
| `Boolean`                                                      | `z.boolean()`                                                                                                            |
| `Date`                                                         | [`mz.date()`](../guides/bson-types.md#dates), which also takes the ISO string a JSON client sends, or `z.date()`         |
| `ObjectId`                                                     | [`mz.objectId()`](../guides/bson-types.md#objectid), which also takes the hex string                                     |
| `Decimal128`                                                   | [`mz.decimal128()`](../guides/bson-types.md#decimal128)                                                                  |
| `Buffer`                                                       | [`mz.binary()`](../guides/bson-types.md#binary-data)                                                                     |
| `UUID`                                                         | [`mz.uuid()`](../guides/bson-types.md#uuid)                                                                              |
| `BigInt`                                                       | `z.bigint()`, with `useBigInt64: true` on the client (see [Schemas](../guides/schemas.md))                               |
| `Int32`                                                        | `z.int32()`                                                                                                              |
| `Mixed`                                                        | `z.unknown()`, or a schema of its shape                                                                                  |
| `Map` with `of`                                                | `z.record(z.string(), …)`: a `z.map()` does not come back from MongoDB, so a model rejects it                            |
| `Union`                                                        | `z.union([…])`, or `z.discriminatedUnion()`                                                                              |
| `[String]`, an array                                           | `z.string().array().default([])`: Mongoose arrays [default to `[]`](https://mongoosejs.com/docs/schematypes.html#arrays) |
| A nested object or a subdocument                               | `z.object({ … })`, with the `_id` that Mongoose [gives each subdocument](https://mongoosejs.com/docs/subdocs.html)       |
| GeoJSON as `{ type: { type: String }, coordinates: [Number] }` | [`mz.point()`](../guides/bson-types.md#geojson), `mz.polygon()` and the rest of the GeoJSON types                        |
| An array of unique values, by hand                             | [`mz.set()`](../guides/bson-types.md#sets)                                                                               |

## Field options

From the [SchemaType options](https://mongoosejs.com/docs/schematypes.html#schematype-options):

| Mongoose                             | mongozod                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `required`                        | `.optional()`: a Zod key is required unless it says so. `.nullable()` too if the field stores `null`.                                                         |
| `required: true`                     | Nothing: Zod keys are required                                                                                                                                |
| `required: true` on a `String`       | `.min(1)`: Mongoose's `required` rejects `''` ([Mongoose docs](https://mongoosejs.com/docs/api/schemastring.html#SchemaString.prototype.checkRequired%28%29)) |
| `default: value`, `default: () => …` | `.default(value)`, `.default(() => …)`                                                                                                                        |
| `enum: [ … ]`                        | `z.enum([ … ])`                                                                                                                                               |
| `min`, `max` on a number or a date   | `.min()`, `.max()`                                                                                                                                            |
| `minLength`, `maxLength`             | `.min()`, `.max()` on the string                                                                                                                              |
| `match: /…/`                         | `.regex(/…/)`                                                                                                                                                 |
| `trim`, `lowercase`, `uppercase`     | `.trim()`, `.toLowerCase()`, `.toUpperCase()`, before the checks that depend on them                                                                          |
| `validate`                           | `.refine()`, also `async` (see [Validation](../guides/validation.md))                                                                                         |
| `set`                                | `.transform()`, or `.overwrite()` to keep the type (see [Transforms](../recipes/transforms.md))                                                               |
| `get`                                | No equivalent: reads return what is stored. A [virtual](../guides/virtuals.md) computes another field.                                                        |
| `index`, `unique`, `sparse`          | An index in `indexes`, such as `index({ email: 1 }, { unique: true })` (see [Indexes](#indexes))                                                              |
| `expires: 3600` on a date            | `index({ createdAt: 1 }, { expireAfterSeconds: 3600 })`, a TTL index on the field                                                                             |
| `ref`                                | `references` (see [Populate](#populate))                                                                                                                      |
| `select: false`                      | Not yet, it is planned. Leave the field out with a projection in each read, such as `{ projection: { password: 0 } }`.                                        |
| `immutable`                          | Not yet, it is planned. `timestamps` already rejects updates of `createdAt`.                                                                                  |
| `alias`                              | Not yet, it is planned.                                                                                                                                       |

## Schema options

From the [schema options](https://mongoosejs.com/docs/guide.html#options):

| Mongoose                                  | mongozod                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `model('User', schema)`                   | `mongozod({ schema, collection: 'users', db })`: the collection is named, not derived from the model                 |
| `collection`                              | `collection`                                                                                                         |
| `timestamps: true`                        | `timestamps: true`, with `createdAt` and `updatedAt` in the schema (see [Timestamps](../guides/timestamps.md))       |
| `timestamps: { createdAt: 'created_at' }` | The same: `timestamps: { createdAt: 'created_at' }`                                                                  |
| `strict: true`, the default               | `z.object()`, which drops the keys it does not declare                                                               |
| `strict: 'throw'`                         | `z.strictObject()`, which rejects them                                                                               |
| `strict: false`                           | `z.looseObject()`, which keeps them                                                                                  |
| `_id: false` on a subdocument             | Leave the `_id` out of its schema                                                                                    |
| `id`, the `id` virtual                    | A virtual (see [IDs](../recipes/ids.md#the-id-virtual))                                                              |
| `versionKey`, `__v`                       | Declared as a field while Mongoose writes (see [`__v`](./differences.md#__v-and-optimistic-concurrency))             |
| `optimisticConcurrency`                   | Not yet, it is planned. Filter by the version by hand (see [`__v`](./differences.md#__v-and-optimistic-concurrency)) |
| `minimize`                                | No equivalent: empty objects are stored as they are                                                                  |
| `autoIndex`, `autoCreate`                 | [`sync()`](../guides/sync.md), which you call                                                                        |
| `discriminatorKey`                        | The key of the `z.discriminatedUnion` (see [Discriminators](#discriminators))                                        |
| `toJSON`, `toObject`                      | Not needed: reads are plain objects (see [Back to JSON](../guides/bson-types.md#back-to-json))                       |
| `capped`, `timeseries`, `collation`       | Create the collection with the driver, before `sync()` (see [Models](../guides/models.md#collection))                |

## Models and operations

From [Models](https://mongoosejs.com/docs/models.html) and the
[Model API](https://mongoosejs.com/docs/api/model.html). A mongozod model has the driver's
operations, with the driver's arguments, options and results. `insertOne` and `insertMany` also
return the stored documents.

| Mongoose                                               | mongozod                                                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `Model.create(doc)`, `new Model(doc).save()`           | `insertOne(doc)`, which returns the stored `document`                                                |
| `Model.create([ … ])`, `Model.insertMany([ … ])`       | `insertMany([ … ])`, which returns the stored `documents`                                            |
| `Model.find(filter, projection, options)`              | `find(filter, { projection, …options })`: the second argument is the options                         |
| `Model.findOne(filter)`                                | `findOne(filter)`                                                                                    |
| `Model.findById(id)`                                   | `findOne({ _id: id })`, with an `ObjectId`: `mz.objectId().parse(id)` turns the hex into one         |
| `Model.findByIdAndUpdate(id, update, { new: true })`   | `findOneAndUpdate({ _id: id }, update, { returnDocument: 'after' })`                                 |
| `Model.findByIdAndDelete(id)`                          | `findOneAndDelete({ _id: id })`                                                                      |
| `Model.updateOne(filter, { title })`                   | `updateOne(filter, { $set: { title } })`: an update takes operators                                  |
| `updateMany`, `replaceOne`, `deleteOne`, `deleteMany`  | The same names                                                                                       |
| `countDocuments`, `estimatedDocumentCount`, `distinct` | The same names                                                                                       |
| `Model.bulkWrite([ … ])`                               | `bulkWrite([ … ])`, which validates every operation before writing                                   |
| `Model.exists(filter)`                                 | `findOne(filter, { projection: { _id: 1 } })`                                                        |
| `Model.aggregate(pipeline)`                            | `aggregate(pipeline, { schema })` (see [Aggregation](../guides/aggregation.md))                      |
| `Model.watch()`                                        | `Model.collection.watch()`, the driver's                                                             |
| `Model.validate(object)`                               | `schema.parse(object)`, or `parseAsync` with async refinements                                       |
| `Model.collection`, `Model.db`                         | `Model.collection` and `Model.db`: the driver's `Collection` and `Db`                                |
| `doc.save()`, `doc.set()`, `doc.isModified()`          | No documents: write with an operation (see [Differences](./differences.md#no-documents-and-no-save)) |
| `doc.deleteOne()`                                      | `deleteOne({ _id: doc._id })`                                                                        |
| `doc.toObject()`, `Model.hydrate()`                    | Not needed: reads are plain objects                                                                  |
| `schema.methods`                                       | Functions that take the document                                                                     |
| `schema.statics`                                       | Functions next to the model, or the `methods` of a [plugin](../plugins/writing-plugins.md)           |

```ts
const id = mz.objectId().parse('64f1c2a9e4b0a1b2c3d4e5f6')

const { document: user } = await UsersModel.insertOne({ name: 'Ana', email: 'Ana@example.com' })
// { _id: ObjectId('…'), name: 'Ana', email: 'ana@example.com', role: 'reader', … }

const renamed = await UsersModel.findOneAndUpdate(
  { _id: user._id },
  { $set: { name: 'Ana María' } },
  { returnDocument: 'after' }
)

// @ts-expect-error: an update takes operators, such as $set
await UsersModel.updateOne({ _id: user._id }, { name: 'Ana' })

const exists = (await PostsModel.findOne({ _id: id }, { projection: { _id: 1 } })) !== null
```

## Queries

From [Queries](https://mongoosejs.com/docs/queries.html) and
[Query casting](https://mongoosejs.com/docs/tutorials/query_casting.html). In mongozod, `find`
returns a cursor that you `await` for the array, or iterate with `for await`. Its options are the
driver's.

| Mongoose                                                   | mongozod                                                                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `await query`, `.exec()`                                   | `await`                                                                                                           |
| `.lean()`                                                  | Not needed: reads are plain objects                                                                               |
| `.select('title -body')`, `.select({ title: 1 })`          | `{ projection: { title: 1 } }`, or `.project({ title: 1 })` on the cursor                                         |
| `.sort('-createdAt')`                                      | `{ sort: { createdAt: -1 } }`, or `.sort({ createdAt: -1 })` on the cursor                                        |
| `.limit(n)`, `.skip(n)`                                    | `{ limit, skip }`, or `.limit(n)` and `.skip(n)` on the cursor                                                    |
| `.where('views').gte(100)`                                 | `{ views: { $gte: 100 } }`                                                                                        |
| `.populate( … )`                                           | `{ populate: { … } }` (see [Populate](#populate))                                                                 |
| `.session(session)`                                        | `{ session }`                                                                                                     |
| `.maxTimeMS()`, `.hint()`, `.collation()`, `.comment()`    | The options of the same names                                                                                     |
| `.cursor()`, `for await` over a query                      | `for await (const post of PostsModel.find())`                                                                     |
| `.orFail()`                                                | Check for `null`                                                                                                  |
| Query helpers, `schema.query`                              | A function that builds the filter or the cursor                                                                   |
| Casting `'42'` to `42`, or a hex string to an `ObjectId`   | No casting: a value of the wrong type does not compile (see [Differences](./differences.md#filters-are-not-cast)) |
| An array for a field that is not one, as an implicit `$in` | `{ $in: [ … ] }`                                                                                                  |
| `strictQuery`                                              | A key that is not a path of the schema does not compile                                                           |

```ts
const recent = await PostsModel.find({ status: 'published', tags: { $in: ['mongodb', 'zod'] } })
  .sort({ createdAt: -1 })
  .limit(20)
  .project({ title: 1, createdAt: 1 })
// Array<{ _id: ObjectId; title: string; createdAt: Date }>

for await (const post of PostsModel.find({ authorId: user._id })) {
  console.log(post.title)
}

// @ts-expect-error: the sort is an object, not a string
await PostsModel.find({}, { sort: '-createdAt' })
```

## Populate

From [Populate](https://mongoosejs.com/docs/populate.html):

| Mongoose                                                                                                      | mongozod                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ref: 'User'`                                                                                                 | `references: { authorId: () => UsersModel }`                                                               |
| A `ref` to a collection without a model                                                                       | `references: { authorId: { collection: 'users', schema } }`                                                |
| `.populate('authorId')`                                                                                       | `{ populate: { authorId: true } }`                                                                         |
| `.populate('authorId', 'name')`, `select`                                                                     | `{ populate: { authorId: { projection: { name: 1 } } } }`                                                  |
| `match`                                                                                                       | `filter`                                                                                                   |
| `options: { sort }`                                                                                           | `sort`                                                                                                     |
| `perDocumentLimit`                                                                                            | `limit`, which counts per document                                                                         |
| `limit`, which [counts across documents](https://mongoosejs.com/docs/populate.html#limit-vs-perDocumentLimit) | No equivalent: `limit` is per document                                                                     |
| `populate` inside `populate`                                                                                  | `populate` inside the options of a reference                                                               |
| A virtual populate, with `localField` and `foreignField`                                                      | A reference with `foreignField`: `{ model: () => CommentsModel, foreignField: 'postId' }`                  |
| `justOne: true`                                                                                               | A reference with `localField` and no `foreignField` (see [Populate](../guides/populate.md#in-another-key)) |
| `refPath`, the `count` option                                                                                 | Not yet, they are planned                                                                                  |
| `Model.populate(docs)`                                                                                        | No equivalent: populate in the read                                                                        |
| `populate` in an aggregation                                                                                  | A `$lookup` stage                                                                                          |

A reference that points to a missing document is `null`, as in Mongoose. See
[Populate](../guides/populate.md).

```ts nocheck
await Post.find({ status: 'published' })
  .populate('authorId', 'name')
  .populate({ path: 'comments', options: { sort: { createdAt: -1 } }, perDocumentLimit: 3 })
```

```ts
const withComments = await PostsModel.find(
  { status: 'published' },
  {
    populate: {
      authorId: { projection: { name: 1 } },
      comments: { sort: { createdAt: -1 }, limit: 3 }
    }
  }
)
// Array<{ …post, authorId: { _id, name } | null, comments: Comment[] }>
```

## Virtuals

From [Virtuals](https://mongoosejs.com/docs/tutorials/virtuals.html):

| Mongoose                                    | mongozod                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `schema.virtual('fullName').get(function)`  | `virtuals: { fullName: schema.pick({ … }).transform(…) }`                                                                |
| A virtual setter                            | No equivalent                                                                                                            |
| `toJSON: { virtuals: true }`, lean virtuals | Not needed: the reads that return documents compute them                                                                 |
| A filter or a sort on a virtual             | Not possible, [as in Mongoose](https://mongoosejs.com/docs/tutorials/virtuals.html#limitations): virtuals are not stored |

```ts
// Another model of the same collection, with a virtual.
const ProfilesModel = mongozod({

  collection: 'users',

  db,

  schema: userSchema,

  virtuals: {

    handle: userSchema
      .pick({ email: true })
      .transform((user) => user.email.split('@')[0] ?? '')
  }
})

const profile = await ProfilesModel.findOne({ _id: user._id }, { projection: { handle: 1 } })
// { _id: ObjectId('…'), handle: 'ana' } | null
```

See [Virtuals](../guides/virtuals.md).

## Timestamps

From [Timestamps](https://mongoosejs.com/docs/timestamps.html):

| Mongoose                             | mongozod                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `timestamps: true`                   | `timestamps: true`, with `createdAt: mz.date()` and `updatedAt: mz.date()` declared |
| Renamed fields                       | `timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }`                  |
| `timestamps: false` in one operation | `timestamps: false` in its options                                                  |
| Writing `updatedAt` in an update     | Does not compile: pass `timestamps: false` to write it                              |
| Timestamps on subdocuments           | No equivalent                                                                       |

See [Timestamps](../guides/timestamps.md).

## Discriminators

From [Discriminators](https://mongoosejs.com/docs/discriminators.html):

| Mongoose                               | mongozod                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Event.discriminator('Click', schema)` | An option of a `z.discriminatedUnion()`, the model's schema                                                     |
| `discriminatorKey: 'kind'`             | `z.discriminatedUnion('kind', [ … ])`                                                                           |
| The default key, `__t`                 | `z.discriminatedUnion('__t', [ … ])`, each option with `__t: z.literal('Click')`, the name of its discriminator |
| A query through the `Click` model      | A filter on the key, such as `find({ kind: 'click' })`, which narrows the type                                  |
| `overwriteDiscriminatorKey`            | `replaceOne` with the new type                                                                                  |
| Embedded discriminators                | A `z.discriminatedUnion()` in a field or an array                                                               |
| A discriminator of a discriminator     | A `z.discriminatedUnion()` inside another, up to three levels                                                   |

See [Document types](../guides/document-types.md).

## Middleware

From [Middleware](https://mongoosejs.com/docs/middleware.html):

| Mongoose                                                     | mongozod                                                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `pre('save')` that changes a field, such as a hash           | A `.transform()` of the field, which runs on every write of it (see [Transforms](../recipes/transforms.md)) |
| `pre('validate')`, checks across fields                      | `.refine()` or `.superRefine()` on the schema                                                               |
| `pre('find')`, `pre('updateOne')` and other query middleware | A plugin's `before` hook, per operation or per group: `read`, `insert`, `update`, `delete`, `bulk`          |
| `post('save')`, `post('find')`                               | A plugin's `after` hook                                                                                     |
| `pre('aggregate')`                                           | A plugin's `aggregate` hook                                                                                 |
| Error handling middleware                                    | A plugin's `middleware`, around `next()`                                                                    |
| `this`, the document or the query                            | The hook's `{ operation, args, context, model }`                                                            |

```ts nocheck
postSchema.pre('find', function () {
  this.where({ status: 'published' })
})
```

```ts
/** Reads published posts only. */
function publishedOnly() {
  return definePlugin({

    id: 'publishedOnly',

    hooks: {

      find: {

        before: ({ args }) => ({
          args: { ...args, filter: { $and: [args.filter, { status: 'published' }] } }
        })
      }
    }
  })
}

const PublishedPostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  plugins: [publishedOnly()]
})
```

See [Plugins](../guides/plugins.md) and [Writing plugins](../plugins/writing-plugins.md).

## Plugins

From [Plugins](https://mongoosejs.com/docs/plugins.html):

| Mongoose                            | mongozod                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| `schema.plugin(plugin, options)`    | `plugins: [plugin(options)]`, in the order they apply                            |
| `mongoose.plugin()`, global plugins | No equivalent: pass the same plugins to each model                               |
| A soft delete plugin                | [`softDelete()`](../plugins/soft-delete.md), from `mongozod/plugins/soft-delete` |
| `mongoose-lean-virtuals`            | Not needed: reads are plain objects with their virtuals                          |

## Indexes

From [Indexes](https://mongoosejs.com/docs/guide.html#indexes) and the
[Model API](https://mongoosejs.com/docs/api/model.html#Model.syncIndexes%28%29):

| Mongoose                                               | mongozod                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `schema.index(fields, options)`                        | `indexes: (index) => [index(fields, options)]`, with the paths checked against the schema |
| `autoIndex`, `Model.init()`, `Model.createIndexes()`   | `await Model.sync()`, from a deploy script                                                |
| `Model.syncIndexes()`, which drops the undeclared ones | `sync()`, which never drops one and returns them in `extraIndexes`                        |
| `Model.diffIndexes()`                                  | The `extraIndexes` of `sync()`                                                            |
| `autoCreate`                                           | MongoDB creates the collection on the first write, or `sync()` with `jsonSchema`          |

See [Sync](../guides/sync.md).

## Transactions

From [Transactions](https://mongoosejs.com/docs/transactions.html):

| Mongoose                                                    | mongozod                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `connection.transaction(fn)`, `session.withTransaction(fn)` | The driver's `client.withSession((session) => session.withTransaction(fn))` |
| `{ session }` in each operation, `.session(session)`        | `{ session }` in each operation                                             |
| `transactionAsyncLocalStorage`                              | No equivalent: pass `{ session }`                                           |

See [Transactions](../guides/transactions.md).

## Errors

From [Errors](https://mongoosejs.com/docs/api/error.html):

| Mongoose                             | mongozod                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `ValidationError`                    | Zod's `ZodError`, with the path of each issue (see [Validation](../guides/validation.md)) |
| `CastError`                          | No casting in the model. What `mz` parses throws a `ZodError`.                            |
| `MongoServerError`, such as `E11000` | The same driver error, unchanged                                                          |
| `VersionError`                       | No equivalent: there is no versioning                                                     |
| `DocumentNotFoundError`              | No equivalent: check for `null`                                                           |
