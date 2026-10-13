---
title: Operations
description: The driver's collection methods as a model wraps them, with their options, results and cursors.
---

Each operation of a model wraps the method of the same name of the driver's `Collection`, with the
same arguments, options and results. MongoZod validates what it writes, types what it reads and
passes the rest to the driver, which runs the query. The inserts also return the stored documents.

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

  authorId: mz.objectId()
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema
})

const authorId = new ObjectId()

const { document: post } = await PostsModel.insertOne({ title: 'Hello, MongoDB', authorId })

await PostsModel.updateOne({ _id: post._id }, { $set: { status: 'published' } })

const published = await PostsModel.find({ status: 'published' }, { sort: { title: 1 }, limit: 20 })
```

| Operation                                                   | Returns                                       |
| ----------------------------------------------------------- | --------------------------------------------- |
| `insertOne`, `insertMany`                                   | The driver's result plus the stored documents |
| `find`                                                      | A cursor you can `await`, iterate or chain    |
| `findOne`                                                   | The document, or `null`                       |
| `updateOne`, `updateMany`, `replaceOne`                     | The driver's `UpdateResult`                   |
| `findOneAndUpdate`, `findOneAndReplace`, `findOneAndDelete` | The document, or `null`                       |
| `deleteOne`, `deleteMany`                                   | The driver's `DeleteResult`                   |
| `countDocuments`, `estimatedDocumentCount`                  | A number                                      |
| `distinct`                                                  | The distinct values of a path                 |
| `bulkWrite`                                                 | The driver's `BulkWriteResult`                |
| `aggregate`                                                 | A cursor, like `find`'s                       |

## Options

Each operation takes the driver's options, such as `session`, `comment`, `hint` or
`maxTimeMS`. What MongoZod adds goes in the same object, and it removes it before calling the
driver:

| Option                 | Where                                                             | Guide                                 |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------- |
| `populate`             | `find`, `findOne` and the `findOneAnd*` of models with references | [Populate](./populate.md)             |
| `timestamps: false`    | The writes of models with `timestamps`                            | [Timestamps](./timestamps.md)         |
| `updatePipeline: true` | `updateOne`, `updateMany`, `findOneAndUpdate` and `bulkWrite`     | [Validation](./validation.md#updates) |
| `schema`               | `aggregate`                                                       | [Aggregation](./aggregation.md)       |
| `context`              | The operations whose plugins ask for it                           | [Plugins](./plugins.md)               |

`sort` and `projection` take objects, checked against the schema (see
[TypeScript](./typescript.md)). A string, as Mongoose takes them
([Mongoose docs](https://mongoosejs.com/docs/api/query.html)), such as `sort: '-createdAt'`, does
not compile and throws a `ZodError`: the driver would sort by a field with that name.

## Insert

`insertOne` and `insertMany` validate each document with the schema and return the driver's result
plus what they stored: `document`, or `documents` in the order they were given. The stored document
is the output of the schema, with its defaults and transforms, so it differs from what you passed:

```ts
const { insertedId, document } = await PostsModel.insertOne({ title: 'Indexes', authorId })
// document: { _id: ObjectId('…'), title: 'Indexes', body: '', status: 'draft', tags: [], authorId: ObjectId('…') }

const { insertedCount, documents } = await PostsModel.insertMany([
  { title: 'Schemas', authorId },
  { title: 'Upserts', authorId, tags: ['updates'] }
])
```

`insertMany` validates every document before it writes any: one that fails rejects the whole batch,
also with `ordered: false`, which only lets the others through on the server's errors, such as a
duplicate key (see [Validation](./validation.md#inserts)).

## Find

`find` returns a cursor, like the driver's `FindCursor`, that you can also `await` for the array of
its documents:

```ts
const drafts = await PostsModel.find({ status: 'draft' })

for await (const draft of PostsModel.find({ status: 'draft' }, { batchSize: 100 })) {
  console.log(draft.title)
}

const latest = await PostsModel.find({ status: 'published' })
  .sort({ _id: -1 })
  .skip(20)
  .limit(10)
  .project({ title: 1 })
// Array<{ _id: ObjectId; title: string }>
```

- **`await` and `toArray()`** read every document at once. **`for await`** reads them batch by
  batch, as the server returns them, and closes the cursor on the server when the loop ends early.
- **Chaining**: the cursor chains `sort`, `limit`, `skip` and `project`, checked against the schema.
  `project` replaces the projection of `find` and types the documents it returns. The other
  modifiers of the driver, such as `hint`, `collation`, `comment`, `batchSize` or `maxTimeMS`, go in
  the options of `find`.
- **Once**: a cursor starts on its first read and is read once. A modifier after it started throws
  an `Error`, and reading it again gives no documents. `close()` frees it on the server before the
  end.

`findOne` takes the same filter and options and returns the first document, or `null`:

```ts
const found = await PostsModel.findOne({ _id: post._id }, { projection: { title: 1, tags: 1 } })
// { _id: ObjectId; title: string; tags: string[] } | null
```

A projection narrows the type of what a read returns (see
[TypeScript](./typescript.md#projections)), and `populate` replaces references with their
documents, one `$in` query per reference and per batch (see [Populate](./populate.md)). To page
through results, see [Pagination](./pagination.md).

## Update

`updateOne`, `updateMany` and `findOneAndUpdate` take the driver's update operators. Each value is
validated with the schema of its path, and `upsert: true` also validates the document it would
insert (see [Validation](./validation.md#updates)):

```ts
await PostsModel.updateOne({ _id: post._id }, { $addToSet: { tags: 'mongodb' } })

await PostsModel.updateMany({ authorId, status: 'draft' }, { $set: { status: 'published' } })

await PostsModel.updateOne(
  { title: 'Roadmap', authorId },
  { $set: { body: 'Coming soon' } },
  { upsert: true }
)
```

An update with an aggregation pipeline needs `updatePipeline: true` in its options, and its values
are not validated, because the server computes them. A pipeline is the server's language,
`$function` included, so it never comes from a client (see
[Security](./security.md#server-side-javascript)):

```ts
await PostsModel.updateMany(
  { authorId },
  [{ $set: { title: { $trim: { input: '$title' } } } }],
  { updatePipeline: true }
)

```

## Replace

`replaceOne` and `findOneAndReplace` validate the replacement like an insert, with its defaults and
the refinements of the whole document. The `_id` of a document cannot change, so the replacement
writes its `_id` only when you pass it: the one its `.default()` generates is dropped, and the
document keeps its own.

```ts
await PostsModel.replaceOne({ _id: post._id }, { title: 'Hello again, MongoDB', authorId })
```

With `upsert: true`, a schema that declares `_id` needs it by equality in the filter, or in the
replacement (see [Validation](./validation.md#replacements)). In a model with `timestamps`, a
replacement without `createdAt` sets it to now: pass the one of the document to keep it (see
[Timestamps](./timestamps.md)).

## Find one and modify

`findOneAndUpdate`, `findOneAndReplace` and `findOneAndDelete` return the document, or `null`, as
the driver does. They take `projection`, `sort` and `populate`, like `findOne`, and
`returnDocument: 'after'` returns the document after the write. With `includeResultMetadata: true`,
they return the driver's `ModifyResult`, with the document in `value`:

```ts
const updated = await PostsModel.findOneAndUpdate(
  { _id: post._id },
  { $set: { status: 'draft' } },
  { returnDocument: 'after', projection: { status: 1 } }
)
// { _id: ObjectId; status: 'draft' | 'published' } | null

const deleted = await PostsModel.findOneAndDelete({ title: 'Roadmap' })
```

## Delete

`deleteOne` deletes the first document that matches the filter, and `deleteMany` all of them. An
empty filter, or none, matches every document, as in the driver:

```ts
const { deletedCount } = await PostsModel.deleteMany({ status: 'draft', authorId })
```

## Count and distinct

`countDocuments` counts the documents that match a filter. `estimatedDocumentCount` reads the
count from the collection's metadata, without a filter. `distinct` takes a path of the document
and returns its values, typed by the schema and with arrays flattened, as the driver does:

```ts
const draftCount = await PostsModel.countDocuments({ status: 'draft' })

const total = await PostsModel.estimatedDocumentCount()

const tags = await PostsModel.distinct('tags', { status: 'published' })
// string[]
```

## Bulk writes

`bulkWrite` runs several writes in one command, with the driver's operations: `insertOne`,
`replaceOne`, `updateOne`, `updateMany`, `deleteOne` and `deleteMany`. Each one is checked and
validated like the operation of the same name, and every one before writing: one that fails
rejects the whole batch, with the issues of each under its index.

```ts
const result = await PostsModel.bulkWrite([
  { insertOne: { document: { title: 'Transactions', authorId } } },
  { updateOne: { filter: { _id: post._id }, update: { $push: { tags: 'driver' } } } },
  { deleteMany: { filter: { status: 'draft', tags: 'obsolete' } } }
])
// result.insertedCount, result.modifiedCount, result.deletedCount…
```

`timestamps: false` and `updatePipeline: true` go in the options of the call and apply to all of
its operations.

## Aggregate

`aggregate(pipeline, { schema })` runs a pipeline and returns a cursor like `find`'s. With
`schema`, each document is validated and typed with it; without one, documents come as the driver
returns them. See [Aggregation](./aggregation.md).

## What the model does not wrap

The model wraps what reads and writes documents. Everything else, such as `watch`, `createIndex`,
`drop` or `rename`, is the driver's, through `model.collection` (see
[Models](./models.md#the-driver-behind-the-model)):

```ts
const changes = PostsModel.collection.watch([{ $match: { operationType: 'update' } }])
```

What you write through `model.collection` skips the validation, `timestamps` and the plugins.

## Transactions

There is no transaction helper: use the driver's `withSession` and `withTransaction`, and pass the
`session` to each operation, which otherwise runs outside of the transaction. A cursor takes its
session when it is created, so `find` gets it in its options. See
[Transactions](./transactions.md).

## Common mistakes

- **Awaiting a cursor twice**: a cursor is read once, so the second `await` gives `[]`. Call `find`
  again.
- **Chaining after reading**: `sort`, `limit`, `skip` or `project` on a cursor that started throws
  an `Error`. Chain them before the first read.
- **Looking for `.map()`, `.next()` or `.hint()` on the cursor**: it chains only `sort`, `limit`,
  `skip` and `project`. Pass the other modifiers in the options of `find`, and map the array or the
  loop.
- **Using the driver's `insertedId` and the object you passed**: the stored document has the
  defaults and transforms of the schema. Read it from `document`.
- **A `replaceOne` that expects the default to give a new `_id`**: the replacement keeps the `_id`
  of the document. Pass an `_id` only to write the same one.
- **An update pipeline without `updatePipeline: true`**: it does not compile and throws a
  `ZodError`. Add the option to the operation.
