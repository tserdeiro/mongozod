---
title: mongozod
description: The reference of the `mongozod` entry point, with mongozod(), the model, its operations and cursors, definePlugin and the types.
---

The `mongozod` entry point exports `mongozod()`, which defines the model of a collection, the
cursors its reads return, `definePlugin` and the types for services and plugins. The `mz` namespace
is in [mongozod/mzod](./mzod.md), and the official soft delete plugin in
[Soft delete](../plugins/soft-delete.md). Each entry links to the guide that explains it.

The examples on this page use these models:

```ts
import type {
  AnyModel,
  BulkWriteOf,
  DocOf,
  FilterOf,
  FindOptionsOf,
  Input,
  InsertOf,
  ReadOf,
  ReadOptionsArg,
  SortOf,
  UpdateOf,
  UpdateOptionsArg
} from 'mongozod'

import { ObjectId } from 'mongodb'
import { definePlugin, mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const userSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  name: z.string(),

  email: z.email()
})

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

export const UsersModel = mongozod({

  collection: 'users',

  db,

  schema: userSchema
})

export const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  timestamps: true,

  indexes: (index) => [
    index({ status: 1, createdAt: -1 })
  ],

  references: {

    authorId: () => UsersModel
  }
})
```

## Models

### mongozod()

`mongozod(options)` defines the model of a collection and returns a [`Model`](#model). See
[Models](../guides/models.md).

| Option       | Type                                                                            | Default     | What it does                                                                                                   |
| ------------ | ------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| `collection` | a string                                                                        | required    | The name of the collection. See [Models](../guides/models.md#collection).                                      |
| `db`         | the driver's `Db`, or a function that returns one                               | required    | The database, or a function called on every operation. See [Models](../guides/models.md#db).                   |
| `schema`     | a `z.object`, or a `z.discriminatedUnion` of objects, of Zod or Zod Mini        | required    | The document as stored. See [Schemas](../guides/schemas.md) and [Document types](../guides/document-types.md). |
| `timestamps` | `true`, or `{ createdAt?, updatedAt? }` with a field name or `false` each       | off         | Sets `createdAt` on insert and `updatedAt` on every write. See [Timestamps](../guides/timestamps.md).          |
| `indexes`    | a function that takes `index` and returns a list of `index(key, options)` calls | none        | The indexes `sync()` creates. See [Sync](../guides/sync.md#indexes).                                           |
| `jsonSchema` | `true`, or `{ validationLevel?, validationAction? }`                            | not applied | A `$jsonSchema` generated from the schema, which `sync()` applies. See [Sync](../guides/sync.md#jsonschema).   |
| `references` | an object whose keys are paths and whose values are targets                     | none        | The fields that `populate` replaces with a document. See [Populate](../guides/populate.md).                    |
| `virtuals`   | an object whose values are Zod schemas                                          | none        | Fields that reads compute from others. See [Virtuals](../guides/virtuals.md).                                  |
| `plugins`    | an array of plugins                                                             | `[]`        | The plugins of the model, the first wrapping the others. See [Plugins](../guides/plugins.md).                  |

`mongozod()` throws an `Error` when the options don't fit, and the types reject most of these
cases first:

- The schema isn't a `z.object` or a `z.discriminatedUnion` of objects, such as a `.transform()` of
  the whole document; a field name has a `.` or starts with `$`; or the schema stores a `z.set()` or
  a `z.map()`, which the driver doesn't read back.
- `timestamps` names a field that isn't in every type of document, or doesn't take a `Date`.
- An index has no key, or one of its keys or `weights` isn't a path of the document.
- A reference isn't a path of the schema, names an array index, goes through a record, or points to
  something that isn't a target.
- A virtual is named like a field, doesn't take an object, or reads a field that a type of document
  doesn't have.
- A plugin needs a field that isn't in every type of document, fills a field that isn't one of its
  `fields`, defines a method that another plugin or the model has, or declares an option of
  MongoZod or of another plugin.

A schema with a `z.bigint()` needs a client with `useBigInt64: true`, or every operation throws
(see [Schemas](../guides/schemas.md)).

### Model

`Model` is the type of what `mongozod()` returns: the driver's operations on one collection, typed
and validated by the schema. You rarely write it: use `typeof PostsModel` with the
[helper types](#types-for-documents). See [Models](../guides/models.md#what-a-model-has).

```ts
const changes = PostsModel.collection.watch()
```

| Property     | What it is                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`     | The schema of each document.                                                                                                            |
| `name`       | The name of the collection.                                                                                                             |
| `db`         | The driver's `Db`: the one the `db` option returns now, when it is a function.                                                          |
| `collection` | The driver's `Collection` of that database, typed with the output of the schema. It skips the validation, the plugins and `timestamps`. |
| `virtuals`   | The `virtuals` option, or `{}`.                                                                                                         |
| `references` | The `references` option, or `{}`.                                                                                                       |

Besides these, a model has the [operations](#operations), [`sync()`](#sync) and the methods its
plugins add. Two more properties, `~timestamps` and `~plugins`, exist only in its type, for the
helper types.

### sync()

`sync()` creates the indexes the model declares and, with `jsonSchema`, applies its `$jsonSchema`.
It returns a [`SyncResult`](#syncresult) and never drops an index. See [Sync](../guides/sync.md).

```ts
const { indexes, extraIndexes } = await PostsModel.sync()
// indexes: ['status_1_createdAt_-1'], extraIndexes: the ones the model doesn't declare
```

## Operations

Each operation wraps the driver's
[`Collection`](https://mongodb.github.io/node-mongodb-native/7.0/classes/Collection.html) method of
the same name, with the same arguments, options and result. On top of the driver, it checks its
filter against the schema, rejects an `undefined` value in it at runtime, validates what it writes,
throwing Zod's `ZodError`, and runs the plugins. See [Operations](../guides/operations.md) and
[Validation](../guides/validation.md).

### aggregate()

`aggregate(pipeline?, options?)` runs an aggregation pipeline and returns a
[`ModelCursor`](#modelcursor). The `schema` option validates and types each result. See
[Aggregation](../guides/aggregation.md).

```ts
const tagCountSchema = z.object({

  _id: z.string(),

  count: z.number()
})

const tagCounts = await PostsModel.aggregate(
  [
    { $match: { status: 'published' } },
    { $unwind: '$tags' },
    { $group: { _id: '$tags', count: { $sum: 1 } } }
  ],
  {
    schema: tagCountSchema
  }
)
// Array<{ _id: string; count: number }>
```

### bulkWrite()

`bulkWrite(operations, options?)` runs several writes in one command and returns the driver's
`BulkWriteResult`. Each operation is validated like the operation of the same name, all of them
before anything is written. See [Operations](../guides/operations.md#bulk-writes).

```ts
const { document: ada } = await UsersModel.insertOne({ name: 'Ada', email: 'ada@example.com' })

await PostsModel.bulkWrite([
  { insertOne: { document: { title: 'Indexes', authorId: ada._id } } },
  { updateMany: { filter: { status: 'draft' }, update: { $set: { status: 'published' } } } },
  { deleteOne: { filter: { title: 'Old news' } } }
])
```

### countDocuments()

`countDocuments(filter?, options?)` counts the documents that match the filter. See
[Operations](../guides/operations.md#count-and-distinct).

```ts
const drafts = await PostsModel.countDocuments({ status: 'draft' })
```

### deleteMany()

`deleteMany(filter?, options?)` deletes every document that matches the filter, and returns the
driver's `DeleteResult`. See [Operations](../guides/operations.md#delete).

### deleteOne()

`deleteOne(filter?, options?)` deletes the first document that matches the filter, and returns the
driver's `DeleteResult`. See [Operations](../guides/operations.md#delete).

```ts
await PostsModel.deleteOne({ title: 'Old news' })
```

### distinct()

`distinct(key, filter?, options?)` returns the distinct values of a path, typed as the values of
that path with arrays flattened. See [Operations](../guides/operations.md#count-and-distinct).

```ts
const tags = await PostsModel.distinct('tags', { status: 'published' })
// string[]
```

### estimatedDocumentCount()

`estimatedDocumentCount(options?)` estimates the number of documents from the collection's
metadata. It has no [group](#group), so it takes no plugin options and no `context`. See
[Operations](../guides/operations.md#count-and-distinct).

### find()

`find(filter?, options?)` finds the documents that match the filter, and returns a
[`ModelFindCursor`](#modelfindcursor) that you can `await` for the array. The projection narrows
the type, and `populate` replaces references with their documents. See
[Operations](../guides/operations.md#find).

```ts
const titles = await PostsModel.find(
  { status: 'published' },
  { projection: { title: 1 }, sort: { createdAt: -1 }, limit: 20 }
)
// Array<{ _id: ObjectId; title: string }>
```

### findOne()

`findOne(filter?, options?)` finds the first document that matches the filter, or `null`, with the
same options as [`find()`](#find). See [Populate](../guides/populate.md) for `populate`.

```ts
const withAuthor = await PostsModel.findOne(
  { status: 'published' },
  { populate: { authorId: { projection: { name: 1 } } } }
)
// withAuthor?.authorId: { _id: ObjectId; name: string } | null
```

### findOneAndDelete()

`findOneAndDelete(filter, options?)` deletes the first document that matches the filter and
returns it, or `null`, or the driver's `ModifyResult` with `includeResultMetadata: true`. See
[Operations](../guides/operations.md#find-one-and-modify).

```ts
const deleted = await PostsModel.findOneAndDelete(
  { title: 'Old news' },
  { projection: { title: 1 } }
)
```

### findOneAndReplace()

`findOneAndReplace(filter, replacement, options?)` replaces the first document that matches the
filter, validated like [`replaceOne()`](#replaceone), and returns it like
[`findOneAndDelete()`](#findoneanddelete). See
[Operations](../guides/operations.md#find-one-and-modify).

### findOneAndUpdate()

`findOneAndUpdate(filter, update, options?)` updates the first document that matches the filter,
validated like [`updateOne()`](#updateone), and returns it like
[`findOneAndDelete()`](#findoneanddelete). See
[Operations](../guides/operations.md#find-one-and-modify).

```ts
const published = await PostsModel.findOneAndUpdate(
  { title: 'Indexes' },
  { $set: { status: 'published' } },
  { returnDocument: 'after' }
)
```

### insertMany()

`insertMany(documents, options?)` validates the documents with the schema and inserts them. It
returns the driver's `InsertManyResult` plus `documents`, as stored. See
[Validation](../guides/validation.md#inserts).

```ts
const { documents } = await PostsModel.insertMany([
  { title: 'Schemas', authorId: ada._id },
  { title: 'Models', authorId: ada._id }
])
```

### insertOne()

`insertOne(document, options?)` validates the document with the schema and inserts it. It returns
the driver's `InsertOneResult` plus `document`, as stored, with its defaults and its `_id`. See
[Validation](../guides/validation.md#inserts).

```ts
const { document: post } = await PostsModel.insertOne({
  title: 'Hello, MongoDB',
  authorId: ada._id
})
// { _id: ObjectId('…'), title: 'Hello, MongoDB', body: '', status: 'draft', tags: [], authorId, … }
```

### replaceOne()

`replaceOne(filter, replacement, options?)` replaces the first document that matches the filter,
with the replacement validated like an insert, and returns the driver's `UpdateResult`. See
[Validation](../guides/validation.md#replacements).

```ts
await PostsModel.replaceOne(
  { _id: post._id },
  { title: 'Hello again', authorId: ada._id, createdAt: post.createdAt }
)
```

### updateMany()

`updateMany(filter, update, options?)` updates every document that matches the filter, validated
like [`updateOne()`](#updateone), and returns the driver's `UpdateResult`. See
[Validation](../guides/validation.md#updates).

```ts
await PostsModel.updateMany({ status: 'draft' }, { $set: { status: 'published' } })
```

### updateOne()

`updateOne(filter, update, options?)` updates the first document that matches the filter, with
each value validated by the schema of its path, and returns the driver's `UpdateResult`. See
[Validation](../guides/validation.md#updates).

```ts
await PostsModel.updateOne({ _id: post._id }, { $addToSet: { tags: 'mongodb' } })
```

## Cursors

`find()` and `aggregate()` return a cursor that starts on the first read. See
[Operations](../guides/operations.md#find).

### ModelCursor

`ModelCursor<T>` is the cursor of `aggregate()`, and the base of
[`ModelFindCursor`](#modelfindcursor). Unlike the driver's cursors, it can be awaited.

```ts
for await (const draft of PostsModel.find({ status: 'draft' })) {
  console.log(draft.title)
}
```

| Member         | What it does                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `await cursor` | Reads every document into an array, like `toArray()`.                                             |
| `for await`    | Reads the documents batch by batch, as the server returns them. A loop that ends early closes it. |
| `toArray()`    | Reads every document. The cursor is exhausted afterwards.                                         |
| `close()`      | Frees the cursor on the server before it is exhausted.                                            |

### ModelFindCursor

`ModelFindCursor` is the cursor of `find()`: a [`ModelCursor`](#modelcursor) that chains `sort`,
`limit`, `skip` and `project`, like the driver's
[`FindCursor`](https://mongodb.github.io/node-mongodb-native/7.0/classes/FindCursor.html). Called
after the cursor starts, they throw an `Error`.

```ts
const latest = await PostsModel.find({ status: 'published' })
  .sort({ createdAt: -1 })
  .limit(10)
  .project({ title: 1, createdAt: 1 })
// Array<{ _id: ObjectId; title: string; createdAt: Date }>
```

| Method                | What it does                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `sort(sort)`          | Sets the sort, with its keys checked against the schema.                                         |
| `limit(n)`            | Sets the maximum number of documents.                                                            |
| `skip(n)`             | Sets the number of documents to skip.                                                            |
| `project(projection)` | Replaces the projection of `find`, checked against the schema, and returns a cursor typed by it. |

## Plugins

### definePlugin()

`definePlugin(plugin)` defines a plugin and returns it, typed by its definition. Write it inside a
function that takes the plugin's configuration. See
[Writing plugins](../plugins/writing-plugins.md), and [Plugins](../guides/plugins.md) to use one.

```ts
/** Adds exists() to a model: true when a document matches the filter. */
export function exists() {
  return definePlugin({

    id: 'exists',

    methods: {

      async exists<M extends AnyModel, const F extends FilterOf<M, F>>(
        this: M,
        filter: F,
        ...options: ReadOptionsArg<M>
      ) {
        return (await this.countDocuments(filter, { ...options[0], limit: 1 })) > 0
      }
    }
  })
}

const commentSchema = z.object({

  postId: mz.objectId(),

  body: z.string()
})

const CommentsModel = mongozod({

  collection: 'comments',

  db,

  schema: commentSchema,

  plugins: [exists()]
})

const hasComments = await CommentsModel.exists({ postId: post._id })
```

| Key          | What it is                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `id`         | Identifies the plugin in error messages. Required.                                                                     |
| `fields`     | A Zod shape with the fields the schema of the model must declare, with a compatible type.                              |
| `fills`      | The names of the `fields` that its `before` hooks fill on inserts and replacements, which these then take as optional. |
| `options`    | A `z.object` per [group](#group) with the options the plugin adds to its operations.                                   |
| `context`    | A `z.object` per group with what each call must pass in `context`.                                                     |
| `hooks`      | `before` and `after` hooks per [operation](#operation) or per group. See [`OperationHooks`](#operationhooks).          |
| `middleware` | A function that wraps the whole operation. See [`MiddlewareInput`](#middlewareinput).                                  |
| `methods`    | Methods added to the model, each with `this` as a generic [`AnyModel`](#anymodel).                                     |

## Types for documents

See [TypeScript](../guides/typescript.md#types-for-services-and-repositories) for these types in
services.

### Input

`Input<S>` is the input of a schema: a document to write, before its defaults and transforms. For
what an insert of a model takes, use [`InsertOf`](#insertof).

```ts
type NewUser = Input<typeof userSchema>
// { _id?: string | ObjectId; name: string; email: string }
```

### Output

`Output<S>` is the output of a schema: a document as stored.

### DocOf

`DocOf<M>` is a document of a model as stored, with its `_id`, without virtuals.

```ts
type Post = DocOf<typeof PostsModel>
```

### ReadOf

`ReadOf<M, O>` is a document as a read of the model returns it, given the `projection`, the
`populate` and the `filter` of `O`, which is optional.

```ts
type PostWithAuthor = ReadOf<
  typeof PostsModel,
  { projection: { title: 1; authorId: 1 }; populate: { authorId: { projection: { name: 1 } } } }
>
// { _id: ObjectId; title: string; authorId: { _id: ObjectId; name: string } | null }
```

### InsertOf

`InsertOf<M>` is what an insert or a replacement of the model takes: the input of its schema, with
the fields of `timestamps` and those its plugins fill optional.

```ts
function createPost(input: InsertOf<typeof PostsModel>) {
  return PostsModel.insertOne(input)
}
```

## Types for queries and options

These types take the model as `typeof`. Declare a filter, an update or a sort as a `const` type
parameter that extends its type, so it is checked key by key. See
[TypeScript](../guides/typescript.md#types-for-services-and-repositories).

### FilterOf

`FilterOf<M, F>` is a filter on the documents of a model.

```ts
function listPosts<const F extends FilterOf<typeof PostsModel, F>>(filter: F) {
  return PostsModel.find(filter)
}
```

### UpdateOf

`UpdateOf<M, U, F, O>` is an update of the documents of a model, given its filter `F` and,
optionally, its options `O`. It rejects the fields of `timestamps`, as the model does.

```ts
function updatePosts<
  const F extends FilterOf<typeof PostsModel, F>,
  const U extends UpdateOf<typeof PostsModel, U, F>
>(filter: F, update: U) {
  return PostsModel.updateMany(filter, update)
}
```

### SortOf

`SortOf<M, Sort>` is a sort on the documents of a model, with each key of `Sort` checked against
the schema.

```ts
function newestPosts<const Sort extends SortOf<typeof PostsModel, Sort>>(sort: Sort) {
  return PostsModel.find({}, { sort }).limit(10)
}

await newestPosts({ createdAt: -1 })
```

### BulkWriteOf

`BulkWriteOf<M, Ops, O>` is the operations of a `bulkWrite` of a model, each checked like the
model's, given the options `O` of the call.

```ts
function writePosts<const Ops extends BulkWriteOf<typeof PostsModel, Ops>>(operations: Ops) {
  return PostsModel.bulkWrite(operations)
}

await writePosts([{ deleteMany: { filter: { status: 'draft' } } }])
```

### FindOptionsOf

`FindOptionsOf<M>` is the options of a `find` or a `findOne` that a service takes from a router:
the driver's, a `sort` of the paths of the document and, on a model with references, a `populate`
as [`mz.populate`](./mzod.md#mzpopulate) outputs it, plus the context its plugins ask for. It is not
generic, so each reference it allows reads as its id, the projected document or `null`.

```ts
function listRecentPosts<const F extends FilterOf<typeof PostsModel, F>>(
  filter: F,
  options: FindOptionsOf<typeof PostsModel> = {}
) {
  const { sort = { createdAt: -1 }, ...rest } = options

  return PostsModel.find(filter, { ...rest, sort })
}

await listRecentPosts({ status: 'published' }, { limit: 20, populate: { authorId: { projection: { name: 1 } } } })
```

### ReadOptionsArg

`ReadOptionsArg<M>` is the options argument of the reads of a model, as a tuple for a rest
parameter: optional, or required with the `context` its plugins ask for. Plugin methods use it to
pass the options on, as in [`definePlugin()`](#defineplugin).

### UpdateOptionsArg

`UpdateOptionsArg<M>` is the options argument of the updates of a model, like
[`ReadOptionsArg`](#readoptionsarg).

```ts
const publishing = definePlugin({

  id: 'publishing',

  methods: {

    publish<M extends AnyModel, const F extends FilterOf<M, F>>(
      this: M,
      filter: F,
      ...options: UpdateOptionsArg<M>
    ) {
      return this.updateMany(filter, { $set: { status: 'published' } }, ...options)
    }
  }
})
```

## Types of the model

### MongozodOptions

`MongozodOptions` is the type of the options of [`mongozod()`](#mongozod), for a function that
builds them.

### ModelSchema

`ModelSchema` is what the `schema` option takes: a `z.object`, or a `z.discriminatedUnion` of
objects or of other discriminated unions, up to three levels, of Zod or Zod Mini. See
[Document types](../guides/document-types.md).

### SyncResult

`SyncResult` is what [`sync()`](#sync) returns: `indexes`, the names of the declared indexes, and
`extraIndexes`, the driver's descriptions of the indexes the model doesn't declare. See
[Sync](../guides/sync.md#what-sync-returns).

## Types for plugins

These types describe what a plugin receives. See [Writing plugins](../plugins/writing-plugins.md)
for how they fit together.

### Plugin

`Plugin<Id, Fields, Options, Context, Methods, Fills>` is the type of a plugin, which
`definePlugin()` infers. See [Annotate a factory](../plugins/writing-plugins.md#annotate-a-factory).

### Hooks

`Hooks<C>` is the type of the `hooks` of a plugin: an [`OperationHooks`](#operationhooks) per
[operation](#operation) or per [group](#group), where `C` is the plugin's `context`.

### OperationHooks

`OperationHooks<O, C>` is the `before({ operation, args, context, model })` and the
`after({ operation, args, context, model, result })` of an operation or a group. `before` may
return `{ args }` or `{ result }`, and `after` may return `{ result }`. See
[Hooks](../plugins/writing-plugins.md#hooks).

### Group

`Group` is a group of operations, which a plugin declares its options, its context and its hooks
for once:

| Group    | Operations                                                                       |
| -------- | -------------------------------------------------------------------------------- |
| `read`   | `find`, `findOne`, `countDocuments`, `distinct`                                  |
| `insert` | `insertOne`, `insertMany`                                                        |
| `update` | `updateOne`, `updateMany`, `replaceOne`, `findOneAndUpdate`, `findOneAndReplace` |
| `delete` | `deleteOne`, `deleteMany`, `findOneAndDelete`                                    |
| `bulk`   | `bulkWrite`                                                                      |

`aggregate` and `estimatedDocumentCount` have no group: only their own hooks and the middleware
run on them.

### Operation

`Operation` is the name of an operation that plugins see: every [operation](#operations) of the
model. `sync()` and `model.collection` don't go through the plugins.

### OperationArgs

`OperationArgs` maps each operation to its arguments as plugins see them, such as
`{ filter, update, options }` for `updateOne`, with documents typed as the driver's `Document`.

### OperationResults

`OperationResults` maps each operation to its result as plugins see it. `find` and `aggregate` give
one batch of documents at a time.

### MiddlewareInput

`MiddlewareInput<C>` is what a `middleware` receives: `{ operation, args, context, model }` and
`next()`, which runs the operation and returns its result. See
[Middleware](../plugins/writing-plugins.md#middleware).

### NextOptions

`NextOptions` is what `next()` takes in a middleware: `{ session? }`, a `ClientSession` of the
driver.

### AnyModel

`AnyModel` is a model as plugins see it: `db`, `name`, `schema` and the operations, which take and
return `Document`s and go through every plugin again. A plugin method declares `this` as a type
parameter that extends it.
