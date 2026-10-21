---
title: Timestamps
description: Fill createdAt when a document is created and updatedAt on every write with the timestamps option.
---

The `timestamps` option of `mongozod()` writes `createdAt` when a document is created and
`updatedAt` on every write, like [Mongoose's](https://mongoosejs.com/docs/timestamps.html). It is
off by default. The schema declares both fields, and the writes take them as optional.

```ts
import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const postSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  title: z.string(),

  status: z.enum(['draft', 'published'])
    .default('draft'),

  createdAt: mz.date(),

  updatedAt: mz.date()
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  timestamps: true
})

const { document: post } = await PostsModel.insertOne({ title: 'Hello, MongoDB' })
// post.createdAt and post.updatedAt: the same Date, the time of the insert

await PostsModel.updateOne({ _id: post._id }, { $set: { status: 'published' } })
// updatedAt: the time of the update
```

## Declare the fields

The schema stays the single source of truth, so it declares the fields `timestamps` writes:

- **In every type of document**, when the schema has [several](./document-types.md).
- **Taking and returning a `Date`**. The usual field is [`mz.date()`](./bson-types.md#dates),
  which also takes the ISO string that a JSON client sends; `z.date()` works too.
- **A `.default()` is optional**: while `timestamps` is on, inserts and replacements take them as
  optional, because MongoZod fills them before validating. A `.default()` still works, and helps
  when the schema is also parsed outside the model, such as in test fixtures: the model's date
  wins over it.

A schema without one of the fields, or with one that does not take a `Date`, does not compile, and
`mongozod()` throws an `Error`, such as `timestamps needs the field "updatedAt" in the schema`.

`timestamps` writes only `createdAt` and `updatedAt`, the dates every document has. Other dates are
events of your domain, such as a `publishedAt`, that your code writes; `deletedAt` belongs to
[`softDelete`](../plugins/soft-delete.md).

## Rename or turn off a field

An object renames each field or turns it off with `false`, as for a log whose documents never
change. A field the object leaves out keeps its name, so `{ updatedAt: false }` writes `createdAt`
only:

```ts
const viewSchema = z.object({

  postId: mz.objectId(),

  viewed_at: mz.date()
})

const PostViewsModel = mongozod({

  collection: 'post_views',

  db,

  schema: viewSchema,

  timestamps: {

    createdAt: 'viewed_at',

    updatedAt: false
  }
})

await PostViewsModel.insertOne({ postId: post._id })
// { _id: ObjectId('…'), postId: ObjectId('…'), viewed_at: Date }
```

## Inserts and replacements

- **`createdAt`** is the one the document gives, or the time of the operation. An import keeps the
  dates of its source.
- **`updatedAt`** is the one the document gives, or, in an insert, the value of `createdAt`, so a
  new document has both equal, as in Mongoose, and one edited at least once has a later
  `updatedAt`. In a replacement, it is the time of the replacement.
- **One time per operation**: every document of an `insertMany` gets the same date.

As in [Mongoose](https://mongoosejs.com/docs/timestamps.html), a replacement without a `createdAt`
gets the time of the replacement. To keep the date of creation, pass the one of the stored
document:

```ts
const current = await PostsModel.findOne({ _id: post._id })

if (current) {
  await PostsModel.replaceOne(
    { _id: post._id },
    {
      title: 'Hello again',
      status: current.status,
      createdAt: current.createdAt
    }
  )
}
// createdAt: the stored one, updatedAt: the time of the replacement
```

## Updates

- **`updatedAt`** goes in the `$set` of every update, with the time of the operation.
- **In an upsert**, `createdAt` goes in `$setOnInsert`, so only a new document gets it, and
  `updatedAt` is the time of the write: a new document has both equal.
- **An update pipeline**, with `updatePipeline: true`, gets a last `$set` stage with `updatedAt`
  and, in an upsert, `createdAt` with `$ifNull`, so an existing document keeps its own.
- **`bulkWrite`** stamps each of its writes as the operation of the same name.

An update that writes `updatedAt`, or `createdAt` outside `$setOnInsert`, does not compile and
throws a `ZodError`, also as the target of a `$rename`:

```ts
// @ts-expect-error: updatedAt is set by timestamps
await PostsModel.updateOne({ _id: post._id }, { $set: { updatedAt: new Date() } })
// ZodError: "updatedAt" is set by timestamps: pass timestamps: false to write it
```

`$setOnInsert` can give `createdAt`, which is the date of creation of an upsert, as in an insert:

```ts
await PostsModel.updateOne(
  { title: 'Imported' },
  { $setOnInsert: { createdAt: new Date('2020-01-01T00:00:00Z') } },
  { upsert: true }
)
```

## Skip them in one operation

`timestamps: false` in the options of an operation skips them, as in Mongoose. Its fields become
regular fields, which the operation can write, to fix them:

```ts
await PostsModel.updateOne(
  { _id: post._id },
  { $set: { createdAt: new Date('2020-01-01T00:00:00Z') } },
  { timestamps: false }
)
```

An insert or a replacement with `timestamps: false` gives the dates, unless the schema has a
`.default()` for them: without them it does not compile, and the schema throws a `ZodError`. In
`bulkWrite`, the option goes in the options of the call and applies to all its operations. It exists
only on the models that have `timestamps`, and MongoZod removes it before calling the driver.

## With the rest of the model

- **`softDelete`** turns a delete into an update, so it also writes `updatedAt`.
- **The types**: `InsertOf<typeof PostsModel>` takes both fields as optional, and `UpdateOf` rejects
  them like the model does. See [TypeScript](./typescript.md#types-for-services-and-repositories).

## Common mistakes

- **Writing `updatedAt` in an update**, with `$set` or `$currentDate`: it does not compile and
  throws a `ZodError`. MongoZod writes it; to set another value, pass `timestamps: false`. Mongoose
  overwrites it without telling you
  ([Mongoose docs](https://mongoosejs.com/docs/timestamps.html)).
- **Replacing a document without its `createdAt`**: the replacement gets the time of the
  replacement. Pass the `createdAt` of the stored document.
- **Declaring a field that does not take a `Date`**, such as `z.iso.datetime()`, which takes and
  returns a string: it does not compile, and `mongozod()` throws an `Error`. Use `mz.date()`.
- **Leaving a field out of one type of document** in a `z.discriminatedUnion`: it does not compile,
  and `mongozod()` throws an `Error`. Declare it in every type, for instance in the base object each
  type extends.
- **Expecting other dates to be filled**, such as `publishedAt`: `timestamps` writes only
  `createdAt` and `updatedAt`. Write the others in your code.
