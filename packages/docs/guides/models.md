---
title: Models
description: Define a model with mongozod(), connect it to a database, and reach the driver for what the model does not wrap.
---

A model ties a schema to a collection. `mongozod()` takes an object with the schema, the name of
the collection and the driver's database, and returns the model, whose operations validate what
they write and type what they read.

```ts
import type { Db } from 'mongodb'

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

export const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema
})

const published = await PostsModel.find({ status: 'published' })
```

## Options

`schema`, `collection` and `db` are required. The others are optional, and each has its own
guide:

| Option       | Takes                                                                                                               | Guide                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `schema`     | A `z.object`, or a `z.discriminatedUnion` of objects, of Zod or Zod Mini                                            | [Schemas](./schemas.md)       |
| `collection` | The name of the collection                                                                                          | This page                     |
| `db`         | The driver's `Db`, or a function that returns one                                                                   | This page                     |
| `indexes`    | A callback that declares the indexes with `index(key, options)`, which `sync()` creates                             | [Sync](./sync.md)             |
| `jsonSchema` | `true`, or `{ validationLevel, validationAction }`: a `$jsonSchema` that `sync()` applies                           | [Sync](./sync.md)             |
| `plugins`    | The plugins of the model, in the order they apply                                                                   | [Plugins](./plugins.md)       |
| `references` | The fields that store the `_id` of another document, which `populate` replaces with that document                   | [Populate](./populate.md)     |
| `timestamps` | `true`, or `{ createdAt, updatedAt }` to rename or turn off each: `createdAt` on insert, `updatedAt` on every write | [Timestamps](./timestamps.md) |
| `virtuals`   | Fields that reads compute from others, each a Zod schema that picks its fields and transforms them                  | [Virtuals](./virtuals.md)     |

A collection that stores several types of document has a `z.discriminatedUnion` as its schema (see
[Document types](./document-types.md)).

## `collection`

The name of the collection. MongoDB creates it on the first write, and `sync()` creates it with
its validator when the model asks for `jsonSchema`. A collection with options of its own, such as
a time series, a capped collection or a default collation, is created with the driver before
`sync()` runs (see [Sync](./sync.md)).

## `db`

The driver's `Db`, as `client.db()` returns it. The model neither connects nor closes the client:
your code keeps doing that, as it does with the driver alone.

`db` can also be a function that returns the `Db`. The model calls it on every operation, so you
can define the model when its module is imported, before the connection exists, such as in tests
that start a server first:

```ts
// Set by the test setup, once the server runs.
let testDb: Db | undefined

const commentSchema = z.object({

  postId: mz.objectId(),

  body: z.string()
    .min(1)
})

const CommentsModel = mongozod({

  collection: 'comments',

  db: () => {

    if (!testDb) throw new Error('the test database is not ready')

    return testDb
  },

  schema: commentSchema
})
```

When the function throws, the operation rejects with its error, and a cursor on its first read.

Since it runs on every operation, the function can also return the database of each request, such
as a tenant's from an `AsyncLocalStorage`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks'

const tenants = new AsyncLocalStorage<Db>()
const acmeDb = client.db('acme')

const TenantPostsModel = mongozod({

  collection: 'posts',

  db: () => {

    const tenantDb = tenants.getStore()

    if (!tenantDb) throw new Error('no tenant: run the operation inside a request')

    return tenantDb
  },

  schema: postSchema
})


// Writes to the posts of the database `acme`.
await tenants.run(acmeDb, () =>
  TenantPostsModel.insertOne({ title: 'Hello, Acme', authorId: new ObjectId() })
)
```

- **Keep a `Db` per tenant**: `client.db(name)` builds a new one on each call, and the model keeps
  the collection of each `Db` it sees.
- **A cursor reads where it was created**: `find` and `aggregate` start on their first read, but
  run in the async context in which they were created, like a promise. A cursor created in a
  tenant's request reads that tenant's database, also for `populate` and the hooks of plugins, even
  when it is read after the request. One created outside of a request doesn't see the tenant, even
  when it is read inside one: with the function above, its first read throws.
- **Throw without a tenant**: a fallback such as `tenants.getStore() ?? db` sends what runs outside
  of a request to that database without an error. Use one only for a database every tenant shares.
- **`sync()` runs on the current database**: run it for each tenant.

[Multi-tenant](../recipes/multi-tenant.md) covers the whole setup.

## What a model has

Besides its operations (see [Operations](./operations.md)), a model exposes:

| Member       | What it is                                                                          |
| ------------ | ----------------------------------------------------------------------------------- |
| `schema`     | The schema of each document.                                                        |
| `name`       | The name of the collection.                                                         |
| `db`         | The driver's `Db`: the one the function returns now, when `db` is a function.       |
| `collection` | The driver's `Collection`, typed with the output of the schema, of that same `Db`.  |
| `virtuals`   | The virtuals of the model.                                                          |
| `references` | The references of the model.                                                        |
| `sync()`     | Creates the declared indexes and applies the `$jsonSchema` (see [Sync](./sync.md)). |

The methods of its plugins are members of the model too, such as the ones of
[soft delete](../plugins/soft-delete.md).

## The driver behind the model

A model wraps the operations that read and write documents. For everything else, such as change
streams, the administration of indexes or dropping the collection, use the driver through
`model.collection` and `model.db`:

```ts
const changes = PostsModel.collection.watch([{ $match: { operationType: 'insert' } }])

const indexes = await PostsModel.collection.indexes()
```

`model.collection` is typed with the output of the schema, but it is the driver's: what you write
through it skips the validation, `timestamps` and the plugins. From `model.db` you also reach the
client, `model.db.client`, which starts the sessions of [transactions](./transactions.md).

## Configuration errors

`mongozod()` throws an `Error` when the model is defined if its options cannot work, such as a
schema whose root is not a document, a field name with a `.`, an index on a path that does not
exist, a `timestamps` field missing from the schema, or a plugin method with the name of a member of
the model. Most of them do not compile either. The guide of each option lists its own, and the
[API reference](../api/mongozod.md#mongozod) lists them all.

## Common mistakes

- **Building a `Db` on every call**: `db: () => client.db(tenant)` works, but builds a `Db` per
  operation, and the model, which keeps a collection per `Db`, builds a collection each time too.
  Keep one `Db` per tenant, such as in a `Map`.
- **Writing through `model.collection`**: it is the driver's collection, so nothing is validated,
  stamped or passed through the plugins. Use the model's operations for documents.
- **Creating a cursor outside the request**: a helper that calls `find` before entering the
  `AsyncLocalStorage` doesn't see the tenant, so it reads another database, or throws. Call `find`
  inside the request.
- **Expecting the indexes to appear**: a model never creates them on its own. Call `sync()` when
  you deploy (see [Sync](./sync.md)).
