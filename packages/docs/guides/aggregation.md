---
title: Aggregation
description: Run aggregation pipelines, validate and type their results with a schema, and check the leading $match stages.
---

`aggregate(pipeline, options)` runs a pipeline on the model's collection, with the driver's
signature and options. mongozod adds one option, `schema`, which validates and types each document
the pipeline returns. Without it, the documents come back as the driver returns them.

```ts
import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import { z } from 'zod'

const postSchema = z.object({
  _id: mz.objectId().default(() => new ObjectId()),
  title: z.string().min(1),
  status: z.enum(['draft', 'published']).default('draft'),
  tags: z.array(z.string()).default([]),
  authorId: mz.objectId(),
  createdAt: mz.date(),
  updatedAt: mz.date()
})

const PostsModel = mongozod({ collection: 'posts', db, schema: postSchema, timestamps: true })

const topTags = await PostsModel.aggregate(
  [
    { $match: { status: 'published' } },
    { $unwind: '$tags' },
    { $group: { _id: '$tags', posts: { $sum: 1 } } },
    { $sort: { posts: -1 } },
    { $limit: 10 }
  ],
  { schema: z.object({ _id: z.string(), posts: z.number().int() }) }
)
// topTags: Array<{ _id: string; posts: number }>
```

## The cursor

`aggregate` returns the same cursor as [`find`](./operations.md): `await` gives the array, and so
does `toArray()`. `for await` reads the documents in the batches the server returns, and validates
each batch as it arrives:

```ts
for await (const tag of PostsModel.aggregate(
  [{ $unwind: '$tags' }, { $group: { _id: '$tags', posts: { $sum: 1 } } }],
  { schema: z.object({ _id: z.string(), posts: z.number().int() }) }
)) {
  console.log(tag._id, tag.posts)
}
```

Unlike the cursor of `find`, it chains nothing: `$sort`, `$skip` and `$limit` go in the pipeline.
`close()` frees the cursor on the server before it ends. The driver's options, such as
`allowDiskUse`, `maxTimeMS`, `hint`, `comment` and `session`, go next to `schema` and reach the
driver as they are.

## The result schema

Each document the pipeline returns goes through `schema`, and the cursor gives the schema's
output. A document that doesn't fit throws a `ZodError`: `await` rejects with it, and `for await`
throws it when it reaches the batch of that document. Each batch is parsed asynchronously, as the
writes are, so the schema may have async refinements.

The documents come from the server as BSON, so the schema takes BSON values: an `ObjectId` for an
`_id`, a `Date` for a date. The [BSON field types](./bson-types.md) take them, and the document's
schema can lend its fields:

```ts
const recentTitles = await PostsModel.aggregate(
  [
    { $match: { status: 'published' } },
    { $sort: { createdAt: -1 } },
    { $limit: 5 },
    { $project: { title: 1, createdAt: 1 } }
  ],
  { schema: postSchema.pick({ _id: true, title: true, createdAt: true }) }
)
// recentTitles: Array<{ _id: ObjectId; title: string; createdAt: Date }>
```

Without `schema`, nothing is validated and each document is a `Document`, as in the driver:

```ts
const counts = await PostsModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
// counts: Document[]
```

## The `$match` stages

The `$match` stages at the start of the pipeline are checked like the model's filter: their paths
exist and their values fit the schema. The check goes on through `$sort`, `$skip` and `$limit`,
which keep the documents as they are, and stops at the first stage that changes their shape, such
as `$group`, `$project` or `$lookup`. The stages after it are not typed one by one.

```ts
await PostsModel.aggregate([
  { $match: { status: 'published', tags: 'mongodb' } },
  { $sort: { createdAt: -1 } },
  // @ts-expect-error: a status is 'draft' or 'published'
  { $match: { status: 'archived' } }
])
```

The check needs the pipeline as a tuple: written in the call, or declared `as const`. An array
declared without `as const`, or typed as `Document[]`, is not checked.

## `$lookup` instead of `populate`

`aggregate` has no `populate` and doesn't compute [virtuals](./virtuals.md). A pipeline resolves
references with `$lookup`:

```ts
const withAuthors = await PostsModel.aggregate(
  [
    { $match: { status: 'published' } },
    { $lookup: { from: 'users', localField: 'authorId', foreignField: '_id', as: 'author' } },
    { $unwind: '$author' },
    { $project: { 'title': 1, 'author.name': 1 } }
  ],
  {
    schema: z.object({
      _id: mz.objectId(),
      title: z.string(),
      author: z.object({ name: z.string() })
    })
  }
)
// withAuthors: Array<{ _id: ObjectId; title: string; author: { name: string } }>
```

`from` takes the name of the collection, which a model gives as its `name`, such as
`UsersModel.name`.

## Plugins

`aggregate` has no filter, so it belongs to no group of operations: the hooks a plugin declares for
a group, such as `read`, don't run on it, and it takes no `context`. A plugin that hides documents
or isolates a tenant doesn't apply. On a model with [`softDelete`](../plugins/soft-delete.md), a
pipeline sees the deleted documents too, so it filters them out itself:

```ts separate
import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import { softDelete } from 'mongozod/plugins/soft-delete'
import { z } from 'zod'

const CommentsModel = mongozod({
  collection: 'comments',
  db,
  schema: z.object({
    _id: mz.objectId().default(() => new ObjectId()),
    postId: mz.objectId(),
    body: z.string(),
    deletedAt: mz.date().optional()
  }),
  plugins: [softDelete()]
})

const commentsPerPost = await CommentsModel.aggregate([
  { $match: { deletedAt: { $exists: false } } },
  { $group: { _id: '$postId', comments: { $sum: 1 } } }
])
```

A plugin can still hook `aggregate` by name, and its `middleware` runs. See
[Plugins](./plugins.md).

## Common mistakes

- **Expecting plugins to filter the pipeline**: `softDelete` and a tenant plugin don't touch
  `aggregate`, so it counts deleted documents and reads other tenants' data. Add their conditions to
  the first `$match`.
- **Validating BSON values with JSON types**: `_id: z.string()` fails on an `ObjectId`, and
  `z.iso.datetime()` on a `Date`. Use `mz.objectId()`, `z.date()` or the document's own fields.
- **Building the pipeline in a variable**: an array declared without `as const` is not a tuple, so
  its `$match` stages are not checked. Write the pipeline in the call, or add `as const`.
- **Expecting `populate` or virtuals**: use `$lookup`, and compute derived fields with `$addFields`
  or in your code.
- **Reading fields of an aggregation without `schema`**: each document is a `Document`, and nothing
  checks the shape you assume. Pass a `schema`.
