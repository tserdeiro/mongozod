---
title: Introduction
description: What mongozod is, what it adds to the MongoDB driver and Zod, and where to start.
---

> [!NOTE]
> mongozod is an independent open-source project. It is not affiliated with, endorsed by or
> sponsored by MongoDB, Inc. MongoDB® is a registered trademark of MongoDB, Inc.

`mongozod` is a library for MongoDB where a [Zod](https://zod.dev) schema is the single source of
truth for each document: it validates what you write, types what you read and defines what each
endpoint accepts. It is the alternative to Mongoose for projects that already speak Zod.

It complements the official driver instead of replacing it. A model wraps a collection: its
operations are the driver's, with the same names, options and results, and the driver stays at hand
for everything the model does not wrap.

```ts
import { MongoClient, ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const client = new MongoClient('mongodb://localhost:27017')

const postSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  title: z.string()
    .min(1),

  tags: z.string()
    .array()
    .default([])
})

const PostsModel = mongozod({

  collection: 'posts',

  db: client.db(),

  schema: postSchema
})

// Validated with the schema: `_id` and `tags` come from their defaults.
const { document: post } = await PostsModel.insertOne({ title: 'Hello, MongoDB' })

// Typed by the schema: `title` is a string, and a filter on a field that does not exist does not
// compile.
const posts = await PostsModel.find({ tags: 'mongodb' })
```

## What it gives you

- **Writes that fit the schema**: inserts, replacements and every value of every update operator
  are validated, and an upsert validates the document it would insert. A failure throws Zod's
  `ZodError`.
- **Types from the schema**: writes take the schema's input and reads return its output. Filters,
  updates, projections and sorts are checked against it, with every MongoDB operator and dotted
  paths, and a projection narrows the result.
- **What Mongoose had**: [`populate`](./guides/populate.md), [virtuals](./guides/virtuals.md),
  [timestamps](./guides/timestamps.md), [several document types](./guides/document-types.md) in
  one collection, [indexes and `$jsonSchema`](./guides/sync.md) and
  [plugins](./guides/plugins.md).
- **Endpoint inputs**: [`mongozod/mzod`](./guides/endpoint-inputs.md) builds Zod schemas that take
  MongoDB syntax from clients, limited to what each endpoint declares, and
  [BSON field types](./guides/bson-types.md) that turn JSON into an `ObjectId`, a `Decimal128` or a
  `Date`, and check GeoJSON.

## Where to start

- New to mongozod: [Installation](./getting-started/installation.md), then the
  [Quick start](./getting-started/quick-start.md).
- Coming from Mongoose: [Migrating from Mongoose](./mongoose/index.md).
- Deciding: [Why mongozod](./getting-started/why-mongozod.md).
- With a coding agent: [AI agents](./getting-started/ai-agents.md).
