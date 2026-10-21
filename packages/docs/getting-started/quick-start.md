---
title: Quick start
description: Define a model from a Zod schema, write and read documents, and accept queries from a client, in one file.
---

This page builds the posts of a blog, from the schema to an endpoint that lists them. It assumes
MongoZod is [installed](./installation.md) and a MongoDB server is running.

## Connect

MongoZod uses the official driver's connection: create a `MongoClient` as you would without it.
[Connection](./connection.md) lists what to set on the client, the user and the server.

```ts
import { MongoClient, ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const client = new MongoClient('mongodb://localhost:27017')

const db = client.db('blog')
```

## Define the schema

The schema describes a document as it is stored. Its defaults fill what a write leaves out.
`mz.objectId()` and `mz.date()` are [BSON field types](../guides/bson-types.md): they store an
`ObjectId` and a `Date`, and also take the string a JSON client sends.

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

  createdAt: mz.date(),

  updatedAt: mz.date()
})
```

See [Schemas](../guides/schemas.md) for what a document schema can hold.

## Define the model

A model ties the schema to a collection. `timestamps: true` sets `createdAt` when a post is created
and `updatedAt` on every write, and `indexes` declares the indexes, which `sync()` creates.

```ts
export const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  timestamps: true,

  indexes: (index) => [
    index({ status: 1, createdAt: -1 })
  ]
})

await PostsModel.sync()
```

`sync()` never runs on its own: call it when the app starts or in a deploy step, or opt in to the
[`autoIndex`](../plugins/auto-index.md) plugin, which creates the indexes on the first operation.
See [Sync](../guides/sync.md).

## Write

Every write is validated with the schema before it reaches the driver. `insertOne` returns the
driver's result plus the `document` it stored, with its defaults:

```ts
const { document: post } = await PostsModel.insertOne({
  title: 'Hello, MongoDB',
  tags: ['mongodb']
})
// { _id: ObjectId('…'), title: 'Hello, MongoDB', body: '', status: 'draft', tags: ['mongodb'], createdAt, updatedAt }

await PostsModel.updateOne({ _id: post._id }, { $set: { status: 'published' } })
await PostsModel.updateOne({ _id: post._id }, { $push: { tags: 'zod' } })
```

An update validates each value with the schema of its field, so `$push` checks that `'zod'` is a
string. What doesn't fit throws Zod's `ZodError`, and the types reject most mistakes before you
run the code:

```ts
// @ts-expect-error: 'archived' is not a status
await PostsModel.updateOne({ _id: post._id }, { $set: { status: 'archived' } })

try {
  await PostsModel.insertOne({ title: '' })
} catch (error) {
  if (error instanceof z.ZodError) console.error(z.prettifyError(error))
  // ✖ Too small: expected string to have >=1 characters
  //   → at title
}
```

See [Validation](../guides/validation.md) for what each write validates.

## Read

Reads take the driver's filters and options, typed by the schema. `find` returns a cursor that you
can `await` for an array, and a projection narrows the type of the result:

```ts
const published = await PostsModel.find(
  { status: 'published', tags: 'mongodb' },
  { projection: { title: 1, createdAt: 1 }, sort: { createdAt: -1 }, limit: 20 }
)
// Array<{ _id: ObjectId; title: string; createdAt: Date }>

const one = await PostsModel.findOne({ _id: post._id })
// The whole post, or null
```

A field that doesn't exist or a value of the wrong type doesn't compile:

```ts
// @ts-expect-error: a status is not a number
await PostsModel.find({ status: 1 })
```

See [Operations](../guides/operations.md) and [TypeScript](../guides/typescript.md).

## Accept queries from a client

An endpoint that lists posts can take MongoDB syntax from the client. The builders of
`mongozod/mzod` turn the schema into Zod schemas that accept only what you declare, and parse each
value with the schema of its field:

```ts
export const listPostsInput = z.object({

  filter: mz
    .filter(postSchema, {
      status: ['$eq'],
      tags: ['$in', '$all'],
      createdAt: ['$gte', '$lt']
    })
    .default({}),

  options: z
    .object({

      sort: mz
        .sort(postSchema, {
          createdAt: true,
          title: true
        })
        .default({ createdAt: -1 }),

      limit: z.number()
        .int()
        .min(1)
        .max(100)
        .default(20)
    })
    .prefault({})
})

// The body of a request, such as
// { "filter": { "tags": { "$in": ["mongodb"] }, "createdAt": { "$gte": "2026-01-01T00:00:00Z" } } }
export async function listPosts(body: unknown) {

  const { filter, options } = listPostsInput.parse(body)

  return PostsModel.find(filter, options)
}
```

The client gets an error for anything else, such as a `$where`, a field or an operator the endpoint
does not declare, or a tag that is not a string. The ISO date arrives as a `Date`, because
`createdAt` is an `mz.date()`. See [Endpoint inputs](../guides/endpoint-inputs.md), and
[Pagination](../guides/pagination.md) for pages that continue after the last post.

## Next steps

- [Schemas](../guides/schemas.md) and [Models](../guides/models.md), to model your own collections.
- [Populate](../guides/populate.md), to read a post with its author.
- [Migrating from Mongoose](../mongoose/index.md), if you are coming from it.
