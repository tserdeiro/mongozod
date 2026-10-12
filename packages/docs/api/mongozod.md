---
title: mongozod
description: The reference of the mongozod entry point, with mongozod(), the model, its operations and cursors, definePlugin and the types.
---

The `mongozod` entry point exports `mongozod()`, which defines the model of a collection, the
cursors its reads return, `definePlugin` and the types for services and plugins. The `mz` namespace
is in [mongozod/mzod](./mzod.md), and the official soft delete plugin in
[Soft delete](../plugins/soft-delete.md).

The examples on this page use these models:

```ts
import type {
  AnyModel,
  DocOf,
  FilterOf,
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
import { z } from 'zod'

const userSchema = z.object({
  _id: mz.objectId().default(() => new ObjectId()),
  name: z.string(),
  email: z.email()
})

const postSchema = z.object({
  _id: mz.objectId().default(() => new ObjectId()),
  title: z.string().min(1),
  body: z.string().default(''),
  status: z.enum(['draft', 'published']).default('draft'),
  tags: z.array(z.string()).default([]),
  authorId: mz.objectId(),
  createdAt: mz.date(),
  updatedAt: mz.date()
})

export const UsersModel = mongozod({ collection: 'users', db, schema: userSchema })

export const PostsModel = mongozod({
  collection: 'posts',
  db,
  schema: postSchema,
  timestamps: true,
  indexes: (index) => [index({ status: 1, createdAt: -1 })],
  references: { authorId: () => UsersModel }
})
```

## Models

### mongozod()

`mongozod(options)` defines the model of a collection and returns a [`Model`](#model). Its options:

| Option       | Type                                                                            | Default     | What it does                                                                                                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collection` | a string                                                                        | required    | The name of the collection. See [Models](../guides/models.md).                                                                                                                                                                                              |
| `db`         | the driver's `Db`, or a function that returns one                               | required    | The database. A function is called on every operation, so the model can be defined before the connection is ready, and it can return each tenant's database. See [Models](../guides/models.md).                                                             |
| `schema`     | a `z.object`, or a `z.discriminatedUnion` of objects, of Zod or Zod Mini        | required    | The document as stored: it validates writes and types reads. See [Schemas](../guides/schemas.md) and [Document types](../guides/document-types.md).                                                                                                         |
| `timestamps` | `true`, or `{ createdAt?, updatedAt? }` with a field name or `false` each       | off         | Writes `createdAt` when a document is created and `updatedAt` on every write. The schema declares both fields, taking a `Date`. See [Timestamps](../guides/timestamps.md).                                                                                  |
| `indexes`    | a function that takes `index` and returns a list of `index(key, options)` calls | none        | The indexes `sync()` creates, like the driver's `createIndex(key, options)`, with each key checked against the schema. See [Sync](../guides/sync.md).                                                                                                       |
| `jsonSchema` | `true`, or `{ validationLevel?, validationAction? }`                            | not applied | Makes `sync()` apply a `$jsonSchema` generated from the schema, so the server also checks what is written outside the model. `true` means `validationLevel: 'strict'` and `validationAction: 'error'`. See [Sync](../guides/sync.md).                       |
| `references` | an object whose keys are paths and whose values are targets                     | none        | The fields that store the `_id` of another document, which `populate` replaces with it. A target is `() => OtherModel`, `{ collection, schema }`, `{ model, localField }` or `{ model, foreignField, localField? }`. See [Populate](../guides/populate.md). |
| `virtuals`   | an object whose values are Zod schemas                                          | none        | Fields that reads compute from others and the database doesn't store, each a `.pick()` of the fields it reads with a `.transform()`. See [Virtuals](../guides/virtuals.md).                                                                                 |
| `plugins`    | an array of plugins                                                             | `[]`        | The plugins of the model, in layers: the first one wraps the others. See [Plugins](../guides/plugins.md).                                                                                                                                                   |

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
  mongozod or of another plugin.

A schema with a `z.bigint()` needs a client or a `Db` with `useBigInt64: true`: without it, every
operation throws an `Error`, because the driver would read the field as a number.

### Model

`Model` is the type of what `mongozod()` returns: the driver's operations on one collection, with
the schema validating what is written and typing what is read. Its type parameters are the schema,
the fields of `timestamps`, the virtuals, the references and the plugins. You rarely write it: use
`typeof PostsModel` with the [helper types](#types-for-documents).

| Property     | What it is                                                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`     | The schema of each document.                                                                                                                                                              |
| `name`       | The name of the collection.                                                                                                                                                               |
| `db`         | The driver's `Db`: the one the `db` option returns now, when it is a function.                                                                                                            |
| `collection` | The driver's `Collection` of that database, typed with the output of the schema, for what the model doesn't wrap, such as `watch`. It skips the validation, the plugins and `timestamps`. |
| `virtuals`   | The `virtuals` option, or `{}`.                                                                                                                                                           |
| `references` | The `references` option, or `{}`.                                                                                                                                                         |

Besides these, a model has the [operations](#operations), [`sync()`](#sync) and the methods its
plugins add. Two more properties, `~timestamps` and `~plugins`, exist only in its type, for the
helper types.

```ts
const changes = PostsModel.collection.watch()
```

### sync()

`sync()` prepares the collection on the server, and returns a [`SyncResult`](#syncresult). Call it
when the app starts or in a deploy step, not on each operation.

```ts
const { indexes, extraIndexes } = await PostsModel.sync()
// indexes: ['status_1_createdAt_-1'], extraIndexes: the ones the model doesn't declare
```

- With `jsonSchema`, it applies the `$jsonSchema` with `collMod`, or creates the collection with it
  when it doesn't exist. Without it, it leaves the collection's validator as it is.
- It creates the declared indexes with the driver's `createIndexes`. It never drops an index: one
  that exists with other options fails with the driver's error, and no index is created.
- `extraIndexes` lists the indexes of the collection that the model doesn't declare, except the
  one on `_id` and the one MongoDB creates on the `metaField` and `timeField` of a time series
  collection.

See [Sync](../guides/sync.md) for the guide.

## Operations

Each operation wraps the driver's
[`Collection`](https://mongodb.github.io/node-mongodb-native/7.0/classes/Collection.html) method of
the same name: it takes the same arguments and options, and returns the same result, but for the
cursors of `find()` and `aggregate()` and the stored documents that inserts add. On top of the
driver, every operation:

- Checks its filter against the schema: each key is a path of the document, each value fits its
  field, and `undefined` doesn't compile. It doesn't cast at runtime: what a client sends goes
  through [`mz.filter`](./mzod.md#mzfilter) first.
- Validates what it writes with the schema, and throws Zod's `ZodError` when it doesn't fit. Reads
  are not validated.
- Runs the plugins of the model. Its options argument also takes the options that the plugins add
  for its group, and it is required, with a `context`, when a plugin of the model asks for one.
- Lets the driver's errors through unchanged.

See [Operations](../guides/operations.md) and [Validation](../guides/validation.md) for the guides.

### aggregate()

`aggregate(pipeline?, options?)` runs an aggregation pipeline and returns a
[`ModelCursor`](#modelcursor).

```ts
const tagCounts = await PostsModel.aggregate(
  [
    { $match: { status: 'published' } },
    { $unwind: '$tags' },
    { $group: { _id: '$tags', count: { $sum: 1 } } }
  ],
  { schema: z.object({ _id: z.string(), count: z.number() }) }
)
// Array<{ _id: string; count: number }>
```

- **`schema`**: an option that validates each document with that Zod schema, asynchronously, so a
  refinement may be async, and types it with its output. Without it, each document is a
  `Document`, as the driver returns it.
- The `$match` stages before the first stage that reshapes the documents are checked like a filter.
- It computes no virtuals and takes no `populate`.
- Plugins run only their `aggregate` hooks and their middleware: no group hook runs, and it takes
  no `context`. A plugin that hides deleted documents or isolates a tenant doesn't apply, so the
  pipeline filters them in its `$match`.

### bulkWrite()

`bulkWrite(operations, options?)` runs several writes in one command and returns the driver's
`BulkWriteResult`.

```ts
const { document: ada } = await UsersModel.insertOne({ name: 'Ada', email: 'ada@example.com' })

await PostsModel.bulkWrite([
  { insertOne: { document: { title: 'Indexes', authorId: ada._id } } },
  { updateMany: { filter: { status: 'draft' }, update: { $set: { status: 'published' } } } },
  { deleteOne: { filter: { title: 'Old news' } } }
])
```

- Each operation is checked and validated like the operation of the same name: `insertOne` like
  an insert, `replaceOne` like [`replaceOne()`](#replaceone), and `updateOne` and `updateMany`
  value by value.
- Every operation is validated before anything is written. One that Zod rejects rejects the whole
  batch, with one `ZodError` whose issues start with the index of each operation, such as
  `[1, '$set', 'title']`. With `ordered: false` too: only the server's errors let the others
  through.
- `timestamps: false` and `updatePipeline: true` go in the options of the call and apply to every
  operation.

### countDocuments()

`countDocuments(filter?, options?)` counts the documents that match the filter, with the filter
checked against the schema.

```ts
const drafts = await PostsModel.countDocuments({ status: 'draft' })
```

### deleteMany()

`deleteMany(filter?, options?)` deletes every document that matches the filter, with the filter
checked against the schema, and returns the driver's `DeleteResult`.

### deleteOne()

`deleteOne(filter?, options?)` deletes the first document that matches the filter, with the filter
checked against the schema, and returns the driver's `DeleteResult`.

```ts
await PostsModel.deleteOne({ title: 'Old news' })
```

### distinct()

`distinct(key, filter?, options?)` returns the distinct values of a path among the documents that
match the filter.

```ts
const tags = await PostsModel.distinct('tags', { status: 'published' })
// string[]
```

The key is a path of the document, which the editor suggests, and a `string` variable doesn't
compile. The result has the type of the values of the path, with arrays flattened, as the driver
returns them.

### estimatedDocumentCount()

`estimatedDocumentCount(options?)` estimates the number of documents from the collection's
metadata, as the driver does. It has no group, so it takes no plugin options and no `context`.

### find()

`find(filter?, options?)` finds the documents that match the filter, and returns a
[`ModelFindCursor`](#modelfindcursor), which you can `await` for the array.

```ts
const titles = await PostsModel.find(
  { status: 'published' },
  { projection: { title: 1 }, sort: { createdAt: -1 }, limit: 20 }
)
// Array<{ _id: ObjectId; title: string }>
```

- `sort` and `projection` are checked against the schema, and the projection narrows the type of
  the documents. Both take an object: a string, as Mongoose takes them, doesn't compile and throws a
  `ZodError`.
- On a `z.discriminatedUnion`, a filter that fixes the discriminator types the documents of those
  types only.
- **`populate`**: an option, on the models with `references`, that replaces each reference with its
  document. When the plugins of a populated model ask for a `context` on reads, the read requires
  it and passes it on. See [Populate](../guides/populate.md).
- It computes the virtuals the projection asks for or keeps.
- It starts on the first read, so an invalid projection or `populate` fails when you read the
  cursor. Pass `session` in its options to read inside a transaction.

[`ReadOf`](#readof) types what it returns, for a service or a response.

### findOne()

`findOne(filter?, options?)` finds the first document that matches the filter, or `null`, with the
same checks, `populate` and virtuals as [`find()`](#find).

```ts
const withAuthor = await PostsModel.findOne(
  { status: 'published' },
  { populate: { authorId: { projection: { name: 1 } } } }
)
// withAuthor?.authorId: { _id: ObjectId; name: string } | null
```

### findOneAndDelete()

`findOneAndDelete(filter, options?)` deletes the first document that matches the filter and
returns it, or `null`. With `includeResultMetadata: true`, it returns the driver's `ModifyResult`
instead, with the document in `value`.

```ts
const deleted = await PostsModel.findOneAndDelete(
  { title: 'Old news' },
  { projection: { title: 1 } }
)
```

Like [`findOne()`](#findone), it checks `sort` and `projection`, takes `populate` and computes the
virtuals. Unlike it, a filter doesn't narrow the types of a `z.discriminatedUnion`.

### findOneAndReplace()

`findOneAndReplace(filter, replacement, options?)` replaces the first document that matches the
filter, validated like [`replaceOne()`](#replaceone), and returns it like
[`findOneAndDelete()`](#findoneanddelete).

### findOneAndUpdate()

`findOneAndUpdate(filter, update, options?)` updates the first document that matches the filter,
validated like [`updateOne()`](#updateone), and returns it like
[`findOneAndDelete()`](#findoneanddelete).

```ts
const published = await PostsModel.findOneAndUpdate(
  { title: 'Indexes' },
  { $set: { status: 'published' } },
  { returnDocument: 'after' }
)
```

### insertMany()

`insertMany(documents, options?)` validates the documents with the schema and inserts them. It
returns the driver's `InsertManyResult` plus `documents`, the documents as stored, with their
defaults and transforms applied and their `_id`.

```ts
const { documents } = await PostsModel.insertMany([
  { title: 'Schemas', authorId: ada._id },
  { title: 'Models', authorId: ada._id }
])
```

Every document is validated before anything is written. One that Zod rejects rejects the whole
batch, with one `ZodError` whose issues start with the index of each document, such as
`[1, 'title']`. With `ordered: false` too: only the server's errors, such as a duplicate key, let
the others through.

### insertOne()

`insertOne(document, options?)` validates the document with the schema and inserts it. It returns
the driver's `InsertOneResult` plus `document`, the document as stored, with its defaults and
transforms applied and its `_id`.

```ts
const { document: post } = await PostsModel.insertOne({
  title: 'Hello, MongoDB',
  authorId: ada._id
})
// { _id: ObjectId('…'), title: 'Hello, MongoDB', body: '', status: 'draft', tags: [], authorId, … }
```

The document takes the input of the schema, with the fields of `timestamps` and those the plugins
fill optional. On a model with `timestamps`, the option `timestamps: false` skips them, and the
document then gives them, unless the schema gives them a `.default()`.

### replaceOne()

`replaceOne(filter, replacement, options?)` replaces the first document that matches the filter,
and returns the driver's `UpdateResult`.

```ts
await PostsModel.replaceOne(
  { _id: post._id },
  { title: 'Hello again', authorId: ada._id, createdAt: post.createdAt }
)
```

- The replacement is validated like an insert, with the defaults, transforms and refinements of
  the schema.
- Its `_id` is written only when it is given: the one a `.default()` generates is dropped, because
  the `_id` of a document can't change.
- With `timestamps`, `createdAt` is now unless the replacement gives it, as in Mongoose: pass the
  document's to keep it.
- With `upsert: true`, a schema that declares `_id` needs it in the filter, by equality, or in the
  replacement: otherwise it throws a `ZodError`, because the server would insert an `ObjectId`.

### updateMany()

`updateMany(filter, update, options?)` updates every document that matches the filter, validated
like [`updateOne()`](#updateone), and returns the driver's `UpdateResult`.

```ts
await PostsModel.updateMany({ status: 'draft' }, { $set: { status: 'published' } })
```

### updateOne()

`updateOne(filter, update, options?)` updates the first document that matches the filter, and
returns the driver's `UpdateResult`.

```ts
await PostsModel.updateOne({ _id: post._id }, { $addToSet: { tags: 'mongodb' } })
```

- Each value is validated with the schema of its path and fits its operator, such as `$inc` on
  numbers and `$unset` on optional fields. The refinements of the whole document run on inserts
  and replacements only: to check them, read the document and replace it.
- With `upsert: true`, it also validates the document the server would insert, and adds the
  missing defaults with `$setOnInsert`.
- With `timestamps`, it sets `updatedAt`, and `createdAt` on an upsert. An update that writes
  `updatedAt`, or `createdAt` outside `$setOnInsert`, doesn't compile and throws a `ZodError`,
  unless it passes `timestamps: false`.
- An update pipeline, an array of stages, needs `updatePipeline: true`. Its values are not
  validated: they are expressions the server computes.

See [Validation](../guides/validation.md) for each operator.

## Cursors

`find()` and `aggregate()` return a cursor that starts on the first read: the `before` hooks of
the plugins run once, when it starts, and their middleware and `after` hooks once per batch the
server returns. It runs in the async context it was created in, like a promise (see
[Models](../guides/models.md#db)).

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

It has no other members: for the driver's `AggregationCursor`, use `PostsModel.collection`.

### ModelFindCursor

`ModelFindCursor` is the cursor of `find()`: a [`ModelCursor`](#modelcursor) that chains `sort`,
`limit`, `skip` and `project`, like the driver's
[`FindCursor`](https://mongodb.github.io/node-mongodb-native/7.0/classes/FindCursor.html).

```ts
const latest = await PostsModel.find({ status: 'published' })
  .sort({ createdAt: -1 })
  .limit(10)
  .project({ title: 1, createdAt: 1 })
// Array<{ _id: ObjectId; title: string; createdAt: Date }>
```

| Method                | What it does                                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sort(sort)`          | Sets the sort, with its keys checked against the schema.                                                                                                                                                       |
| `limit(n)`            | Sets the maximum number of documents.                                                                                                                                                                          |
| `skip(n)`             | Sets the number of documents to skip.                                                                                                                                                                          |
| `project(projection)` | Sets the projection, checked against the schema, and returns a cursor typed by it. It replaces the projection of `find`, as in the driver. A projection that leaves out a populated reference doesn't compile. |

The methods set the options of `find`, which the plugins see when the cursor starts. Called after
it starts, they throw an `Error`, like the driver's:
`the cursor already started: set limit before reading it`. The driver's other modifiers, such as
`hint`, `collation`, `comment`, `batchSize` or `maxTimeMS`, go in the options of `find()`.

## Plugins

### definePlugin()

`definePlugin(plugin)` defines a plugin and returns it, typed by its definition. Write it inside a
function, so the plugin can take its own configuration, and pass its result to the `plugins` option
of a model.

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

const CommentsModel = mongozod({
  collection: 'comments',
  db,
  schema: z.object({ postId: mz.objectId(), body: z.string() }),
  plugins: [exists()]
})

const hasComments = await CommentsModel.exists({ postId: post._id })
```

| Key          | What it is                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | Identifies the plugin in error messages. Required.                                                                                            |
| `fields`     | A Zod shape with the fields the schema of the model must declare, with a compatible type.                                                     |
| `fills`      | The names of the `fields` that its `before` hooks fill on inserts and replacements, which these then take as optional.                        |
| `options`    | A `z.object` per [group](#group) with the options the plugin adds to its operations. They are validated and removed before the driver's call. |
| `context`    | A `z.object` per group with what each call must pass in `context`. It makes the options argument of those operations required.                |
| `hooks`      | `before` and `after` hooks per [operation](#operation) or per group. See [`OperationHooks`](#operationhooks).                                 |
| `middleware` | A function that wraps the whole operation, for a transaction or a measure of time. See [`MiddlewareInput`](#middlewareinput).                 |
| `methods`    | Methods added to the model. Each declares `this` as a generic [`AnyModel`](#anymodel), so it takes the types of the model it is called on.    |

A `context` or a plugin option that doesn't fit its schema throws a `ZodError` when the operation
runs, with the issues of the context under `['context', …]`. See
[Writing plugins](../plugins/writing-plugins.md) for the guide, and [Plugins](../guides/plugins.md)
to use them.

## Types for documents

### Input

`Input<S>` is the input of a schema: a document to write, before its defaults and transforms. For
what an insert of a model takes, use [`InsertOf`](#insertof), which also leaves the fields of
`timestamps` and of the plugins optional.

```ts
type NewUser = Input<typeof userSchema>
// { _id?: string | ObjectId; name: string; email: string }
```

### Output

`Output<S>` is the output of a schema: a document as stored.

### DocOf

`DocOf<M>` is a document of a model as stored, with its `_id`, without virtuals: the output of its
schema.

```ts
type Post = DocOf<typeof PostsModel>
```

### ReadOf

`ReadOf<M, O>` is a document as a read of the model returns it, given the `projection`, the
`populate` and the `filter` of `O`, which is optional. Use it to type a service or a response
without `Awaited<ReturnType<…>>`.

```ts
type PostWithAuthor = ReadOf<
  typeof PostsModel,
  { projection: { title: 1; authorId: 1 }; populate: { authorId: { projection: { name: 1 } } } }
>
// { _id: ObjectId; title: string; authorId: { _id: ObjectId; name: string } | null }
```

### InsertOf

`InsertOf<M>` is what an insert or a replacement of the model takes: the input of its schema, with
the fields of `timestamps` and the fields its plugins fill optional. Use it for a function that
builds a document, such as a service.

```ts
function createPost(input: InsertOf<typeof PostsModel>) {
  return PostsModel.insertOne(input)
}
```

## Types for queries and options

These types take the model as `typeof`. `FilterOf` and `UpdateOf` check what a function passes on
to the model key by key, as the model does: declare the argument as a `const` type parameter that
extends them.

### FilterOf

`FilterOf<M, F>` is a filter on the documents of a model, for a function that takes one and passes
it to the model.

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

`SortOf<M, Sort>` is a sort on the documents of a model: each key of `Sort` is checked against the
schema, with the paths the editor suggests.

```ts
const newestFirst: SortOf<typeof PostsModel, { createdAt: -1 }> = { createdAt: -1 }
```

### ReadOptionsArg

`ReadOptionsArg<M>` is the options argument of the reads of a model, as a tuple for a rest
parameter: optional, or required with the `context` its plugins ask for. Plugin methods use it to
pass the options on, as in [`definePlugin()`](#defineplugin).

### UpdateOptionsArg

`UpdateOptionsArg<M>` is the options argument of the updates of a model, as a tuple for a rest
parameter, like [`ReadOptionsArg`](#readoptionsarg), for a plugin method that updates.

```ts
const publishing = definePlugin({
  id: 'publishing',
  methods: {
    publish<M extends AnyModel, const F extends FilterOf<M, F>>(
      this: M,
      filter: F,
      ...options: UpdateOptionsArg<M>
    ) {
      return this.updateMany(filter, { $set: { status: 'published' } }, options[0])
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
objects or of other discriminated unions, up to three levels, of Zod or Zod Mini.

### SyncResult

`SyncResult` is what [`sync()`](#sync) returns: `indexes`, the names of the declared indexes,
created now or already there, and `extraIndexes`, the driver's descriptions of the indexes of the
collection that the model doesn't declare.

## Types for plugins

These types describe what a plugin receives. See [Writing plugins](../plugins/writing-plugins.md)
for how they fit together.

### Plugin

`Plugin<Id, Fields, Options, Context, Methods, Fills>` is the type of a plugin, which
`definePlugin()` infers. Write it to annotate the return type of a plugin's function. The types
count the fields it fills only when `Fills` names them in a tuple, as `definePlugin()` infers it:
an annotation without it fills none.

### Hooks

`Hooks<C>` is the type of the `hooks` of a plugin: an [`OperationHooks`](#operationhooks) per
[operation](#operation) or per [group](#group), where `C` is the plugin's `context`.

### OperationHooks

`OperationHooks<O, C>` is the `before` and `after` of an operation, or of the operations of a group:

- `before({ operation, args, context, model })` runs before the operation, with its arguments as
  written. It may return `{ args }` to go on with other arguments, `{ result }` to skip the
  operation, or nothing. An error it throws stops the operation.
- `after({ operation, args, context, model, result })` runs after the operation, and may return
  `{ result }` to replace its result, or nothing.

In a group hook, `args` and `result` are those of any operation of the group: narrow `operation`
before you return them.

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
`{ filter, update, options }` for `updateOne`, with documents typed as the driver's `Document`. An
`update` may be a pipeline, an array of stages, when the call passes `updatePipeline: true`.

### OperationResults

`OperationResults` maps each operation to its result as plugins see it, with an `_id` of any type.
`find` and `aggregate` give one batch of documents at a time.

### MiddlewareInput

`MiddlewareInput<C>` is what a `middleware` receives: `{ operation, args, context, model }` and
`next()`, which runs the operation and returns its result. `next({ session })` runs it with the
session of a transaction. On `find` and `aggregate`, `next()` ignores a session: the cursor keeps
the one it started with.

### NextOptions

`NextOptions` is what `next()` takes in a middleware: `{ session? }`, a `ClientSession` of the
driver.

### AnyModel

`AnyModel` is a model as plugins see it: `db`, `name`, `schema` and the operations, which take and
return `Document`s and go through every plugin again, so a hook can dispatch another operation.
A plugin method declares `this` as a type parameter that extends it, to take the types of the model
it is called on.
