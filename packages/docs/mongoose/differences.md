---
title: Differences from Mongoose
description: What works another way than in Mongoose, such as explicit writes instead of save(), filters without casting, __v and an explicit sync().
---

mongozod keeps the driver's way of working with documents: a read returns the document as MongoDB
stores it, and each write is an operation that says what changes. Most differences with Mongoose
come from there. The habit that changes the most is `save()`:

```ts nocheck
const post = await Post.findById(id)

post.status = 'published'
post.tags.push('mongodb')
await post.save()
```

In mongozod, the change is the update:

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

  body: z.string()
    .default(''),

  status: z.enum(['draft', 'published'])
    .default('draft'),

  tags: z.string()
    .array()
    .default([]),

  authorId: mz.objectId(),

  __v: z.number()
    .int()
    .default(0)
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema
})

const id = mz.objectId().parse('64f1c2a9e4b0a1b2c3d4e5f6')

await PostsModel.updateOne(
  { _id: id },
  { $set: { status: 'published' }, $push: { tags: 'mongodb' } }
)
```

The [cheatsheet](./cheatsheet.md) has the equivalent of each feature. This page explains the
differences that change how you write code.

## No documents and no `save()`

Mongoose returns documents: instances of the model that track your changes, which `save()` sends as
an `updateOne()` of the modified paths
([Mongoose docs](https://mongoosejs.com/docs/documents.html#updating-using-save)). mongozod returns
the driver's plain objects, like a Mongoose query with `lean()`
([Mongoose docs](https://mongoosejs.com/docs/tutorials/lean.html)), and writes with the driver's
operations:

| With a Mongoose document                    | With mongozod                                                   |
| ------------------------------------------- | --------------------------------------------------------------- |
| `new Post(data).save()`                     | `insertOne(data)`, which returns the stored `document`          |
| `post.title = title`, then `post.save()`    | `updateOne({ _id }, { $set: { title } })`                       |
| `post.tags.push(tag)`, `addToSet`, `pull`   | `$push`, `$addToSet`, `$pull`                                   |
| A document changed in memory, then `save()` | `replaceOne({ _id }, post)`, which validates the whole document |
| `post.deleteOne()`                          | `deleteOne({ _id })`                                            |
| `post.isModified('title')`                  | No equivalent: the update says what changes                     |
| An instance method                          | A function that takes the document                              |

Every write is validated with the schema, not only `save()`: an insert and a replacement as a whole
document, and an update value by value, with the schema of each path and the rules of each operator.
Mongoose runs its update validators only with `runValidators`, and only on some operators
([Mongoose docs](https://mongoosejs.com/docs/validation.html#update-validators)). See
[Validation](../guides/validation.md).

Middleware on `save` has no operation to attach to. Mongoose does not run it on `updateOne()` or
`findOneAndUpdate()` either ([Mongoose docs](https://mongoosejs.com/docs/middleware.html#notes)).
A `pre('save')` that changes a field becomes a `.transform()` of the field, which runs on every
write of that field (see [Transforms](../recipes/transforms.md)), and the rest becomes a
[plugin](../guides/plugins.md).

## Updates take operators

Mongoose treats the keys of an update that are not operators as a `$set`
([Mongoose docs](https://mongoosejs.com/docs/api/model.html#Model.findOneAndUpdate%28%29)). mongozod
passes the update to the driver as it is, so it takes operators only:

```ts
// @ts-expect-error: "status" is not an update operator
await PostsModel.updateOne({ _id: id }, { status: 'published' })

await PostsModel.updateOne({ _id: id }, { $set: { status: 'published' } })
```

Without types, the first one throws a `ZodError`: `"status" is not an update operator`. To write the
whole document, use `replaceOne`.

## Filters are not cast

Mongoose casts each value of a filter to the type of its field when the query runs, such as `'50'`
to `50` or a hex string to an `ObjectId`, and throws a `CastError` when it cannot
([Mongoose docs](https://mongoosejs.com/docs/tutorials/query_casting.html)). mongozod leaves filters
as they are, as the driver does, and checks them with their types instead: a value of the wrong type
does not compile.

```ts
// @ts-expect-error: a string is not an ObjectId
await PostsModel.findOne({ _id: '64f1c2a9e4b0a1b2c3d4e5f6' })

// @ts-expect-error: status is a string, so an array needs $in
await PostsModel.find({ status: ['draft', 'published'] })

await PostsModel.findOne({ _id: mz.objectId().parse('64f1c2a9e4b0a1b2c3d4e5f6') })
await PostsModel.find({ status: { $in: ['draft', 'published'] } })
```

- **Without types**, such as in JavaScript or with a filter typed `any`, a value of another type
  matches nothing, without an error: `{ _id: '64f1…' }` finds no document whose `_id` is an
  `ObjectId`.
- **What a client sends** arrives without types, so parse it first: `mz.objectId().parse(id)` for an
  id, and [`mz.filter`](../guides/endpoint-inputs.md) for a whole filter, which converts each value
  with the schema of its field and accepts only what the endpoint declares.
- **Keys** that are not paths of the schema do not compile, where Mongoose's `strictQuery` keeps or
  drops them ([Mongoose docs](https://mongoosejs.com/docs/tutorials/query_casting.html#the-strictquery-option)).
- **Pipelines**: Mongoose does not cast them
  ([Mongoose docs](https://mongoosejs.com/docs/queries.html#versus-aggregation)), so a string for an
  `ObjectId` in a `$match` finds nothing
  ([Automattic/mongoose#1399](https://github.com/Automattic/mongoose/issues/1399)). mongozod types
  the `$match` stages at the start of a pipeline like a filter (see
  [Aggregation](../guides/aggregation.md)).

## Reads are plain and not validated

A read returns what the driver returns, with the [virtuals](../guides/virtuals.md) and the
[populated](../guides/populate.md) references you ask for. mongozod does not run the schema on it:

- **No getters**: a transform runs when a value is written, not when it is read.
- **No defaults on old documents**: a document stored before a field or its `.default()` existed is
  read without that field, although its type says it is there. Migrate those documents when you add
  the field (see [Schema migrations](../recipes/schema-migrations.md)).
- **No validation**: a stored document that does not fit the schema is read as it is. Before you
  switch a collection to mongozod, check its documents with `safeParse` (see
  [Migrating from Mongoose](./index.md#verify)).

## `insertMany` validates the whole batch

Mongoose validates each document before it inserts, and with `ordered: false` it inserts the valid
ones and reports the others ([Mongoose docs](https://mongoosejs.com/docs/api/model.html#Model.insertMany%28%29)).
mongozod validates every document first, also with `ordered: false`: one invalid document rejects
the batch, nothing is written, and a single `ZodError` lists the issues of every invalid document
under its index, such as `[1, 'title']`. `ordered: false` still lets the other documents through
when the server rejects one, such as for a duplicate key. `bulkWrite` works the same way. See
[Validation](../guides/validation.md#inserts).

## An explicit `sync()`

When a Mongoose app starts, each model creates its collection and calls `createIndex` for each index
of its schema, unless its `autoCreate` and `autoIndex` options are off
([Mongoose docs](https://mongoosejs.com/docs/guide.html#autoCreate)). The Mongoose docs recommend
turning the creation of indexes off in production
([Mongoose docs](https://mongoosejs.com/docs/guide.html#indexes)), and `syncIndexes()` also drops
the indexes the schema does not declare
([Mongoose docs](https://mongoosejs.com/docs/api/model.html#Model.syncIndexes%28%29)).

mongozod does nothing when the app starts. `sync()` creates the declared indexes, and applies the
`$jsonSchema` when the model asks for it, when you call it, such as from a deploy script. It never
drops an index: it returns the ones the model does not declare in `extraIndexes`. MongoDB creates
the collection on the first write.

```ts
const { indexes, extraIndexes } = await PostsModel.sync()
```

While Mongoose and mongozod share a collection, Mongoose keeps creating the indexes of its schema
when it starts. An index that both declare with the same keys and options exists once. See
[Sync](../guides/sync.md).

## `__v` and optimistic concurrency

Mongoose writes a version key, `__v`, in each document it creates, and only `save()` changes it
([Mongoose docs](https://mongoosejs.com/docs/guide.html#versionKey)). With `optimisticConcurrency`,
`save()` fails when the document changed since it was read
([Mongoose docs](https://mongoosejs.com/docs/guide.html#optimisticConcurrency)).

mongozod does not know about `__v`. An update that does not write it keeps it, but a `z.object`
drops the keys it does not declare, so a `replaceOne` or a `findOneAndReplace` removes it. While
Mongoose still writes the collection, declare it as `postSchema` does above,
`__v: z.number().int().default(0)`, so that the documents mongozod inserts start from `0`, as
Mongoose's do, and Mongoose's `save()` works on them. A replacement keeps it when you pass the
document you read. Leave it out if the Mongoose schema sets `versionKey: false`.

Optimistic concurrency is planned as a plugin. Until then, write it in the update: filter by the
version you read, and increase it.

```ts
const read = await PostsModel.findOne({ _id: id })

if (read) {
  const { matchedCount } = await PostsModel.updateOne(
    { _id: read._id, __v: read.__v },
    { $set: { title: 'Hello again' }, $inc: { __v: 1 } }
  )
  // matchedCount is 0 when another write changed the post since the read.
}
```

Once Mongoose no longer writes the collection and you remove `__v` from the schema, the stored
documents keep it. Remove it from them through the driver's collection, which takes any path:

```ts
await PostsModel.collection.updateMany({}, { $unset: { __v: '' } })
```

## Smaller differences

- **Collection names, optional fields and required strings**: Mongoose derives the collection name
  from the model, and a Zod key is required unless it is `.optional()`. See
  [Write the Zod schema](./index.md#1-write-the-zod-schema) and the
  [cheatsheet](./cheatsheet.md#field-options).
- **Empty objects**: Mongoose removes them by default, with its `minimize` option
  ([Mongoose docs](https://mongoosejs.com/docs/guide.html#minimize),
  [Automattic/mongoose#8505](https://github.com/Automattic/mongoose/issues/8505)). mongozod stores
  them.
- **Upserts**: Mongoose adds the defaults of the schema to the document an upsert inserts, with
  `$setOnInsert` ([Mongoose docs](https://mongoosejs.com/docs/defaults.html#the-setdefaultsoninsert-option)).
  mongozod does too, and also validates that document: an upsert that would insert one without a
  required field throws a `ZodError`
  ([Automattic/mongoose#7037](https://github.com/Automattic/mongoose/issues/7037)). See
  [Validation](../guides/validation.md).
- **`findOneAndUpdate`**: both return the document as it was before the update, by default
  ([Mongoose docs](https://mongoosejs.com/docs/api/model.html#Model.findOneAndUpdate%28%29)). Mongoose's
  `new: true` is the driver's `returnDocument: 'after'`.
- **Discriminator key**: Mongoose adds its own field, `__t` by default
  ([Mongoose docs](https://mongoosejs.com/docs/discriminators.html#discriminator-keys)). In mongozod
  the key of a `z.discriminatedUnion` is a field of the schema, so for documents written by Mongoose
  it is `__t`, or the `discriminatorKey` of its schema (see
  [Document types](../guides/document-types.md)).
- **Errors**: a validation throws Zod's `ZodError`, not a `ValidationError`, and there is no
  `CastError`. The driver's errors, such as a duplicate key, are the same in both.
- **Transactions**: mongozod takes the session in the options of each operation, `{ session }`, also
  when Mongoose's `transactionAsyncLocalStorage` is on (see
  [Share the connection](./index.md#share-the-connection)).

## Not there yet

Some Mongoose features have no equivalent yet. These are planned:

- **`select: false`, `immutable` and `alias`**, as plugins or recipes. Until then, leave a field out
  with a projection in each read, such as `{ projection: { password: 0 } }`, and leave the fields
  that never change out of the allow lists of [`mz.update`](../guides/endpoint-inputs.md).
- **A version plugin**, for optimistic concurrency with `__v` (see
  [above](#__v-and-optimistic-concurrency)).
- **Field-level encryption** declared in the schema.
- **A plugin for the integrity of references**, with cascading deletes.
- **Temporal codecs**. Dates are `Date`s, and a date without a time, such as a birthday, is a string
  of `z.iso.date()` (see [Dates and money](../recipes/dates-and-money.md)).
- **`refPath` and the `count` option** of `populate`.

Others have no plan yet: virtual setters, getters, `timestamps` in subdocuments, the `populate` of a
`Map`, `Model.populate()` on documents already read, and global plugins.

## Common mistakes

- **A projection as the second argument of `find`**: it is the options, as in the driver, so
  `find(filter, { title: 1 })` does not compile, and without types the driver ignores the unknown
  option and returns whole documents. Write `find(filter, { projection: { title: 1 } })`.
- **An update without operators**: `updateOne(filter, { title })` does not compile and throws a
  `ZodError`. Write `{ $set: { title } }`.
- **A string where an `ObjectId` goes**: it does not compile, and without types it finds nothing.
  Parse it with `mz.objectId()`, or take the filter through `mz.filter`.
- **Strings for `sort`, `projection` or `populate`**, such as `sort: '-createdAt'`: they do not
  compile, and they throw a `ZodError`. Write objects: `{ createdAt: -1 }`, `{ title: 1 }`,
  `{ authorId: true }`.
- **Changing a read and expecting it to be saved**: a read is a plain object. Write the change with
  `updateOne`, or the whole document with `replaceOne`.
- **Chaining Mongoose's query methods**: the cursor of `find` chains `sort`, `limit`, `skip` and
  `project` only. `populate`, `lean()` and `exec()` do not exist: `populate` goes in the options,
  and the other two are not needed.
