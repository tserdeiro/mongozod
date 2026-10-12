---
title: Repositories
description: Write generic helpers, such as paginate, and services per model, typed with ReadOf, FilterOf and InsertOf.
---

A helper that works with any model, such as `paginate`, takes the query as a callback and is
generic over what the query returns. Each call checks its filter and options against its own model,
and the helper gets the type of the documents from the result:

```ts
import type { FilterOf, InsertOf, ReadOf } from 'mongozod'

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

  authorId: mz.objectId(),

  createdAt: mz.date(),

  updatedAt: mz.date()
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  timestamps: true
})

interface Page<T> {
  items: T[]
  hasNext: boolean
}

/** Reads one page, asking for one document more to know whether another page follows. */
export async function paginate<T>(
  query: (window: { skip: number; limit: number }) => PromiseLike<T[]>,
  page: number,
  size = 20
): Promise<Page<T>> {

  const items = await query({ skip: (page - 1) * size, limit: size + 1 })

  return { items: items.slice(0, size), hasNext: items.length > size }
}

const { items } = await paginate(
  (window) =>
    PostsModel.find(
      { status: 'published' },
      { ...window, projection: { title: 1, createdAt: 1 }, sort: { createdAt: -1 } }
    ),
  2
)
// items: Array<{ _id: ObjectId; title: string; createdAt: Date }>
```

The cursor of `find` can be awaited, so it is a `PromiseLike` of its documents. See
[Pagination](../guides/pagination.md) for `skip` and `limit`, and for `mz.after`, which continues
after the last document of a page.

## A service per model

A service that receives a filter, a document to insert or a read to return types it from its model
with `FilterOf`, `InsertOf` and `ReadOf`. See
[TypeScript](../guides/typescript.md#types-for-services-and-repositories) for what each one is, and
the other exported types, such as `DocOf` and `UpdateOf`.

```ts
type PostSummary = ReadOf<typeof PostsModel, { projection: { title: 1; createdAt: 1 } }>

export const postsService = {

  create(post: InsertOf<typeof PostsModel>) {
    return PostsModel.insertOne(post)
  },

  count<const F extends FilterOf<typeof PostsModel, F>>(filter: F) {
    return PostsModel.countDocuments(filter)
  },

  async latest(authorId: ObjectId): Promise<PostSummary[]> {
    return PostsModel.find(
      { authorId, status: 'published' },
      { projection: { title: 1, createdAt: 1 }, sort: { createdAt: -1 }, limit: 10 }
    )
  }
}

await postsService.count({ status: 'published' })

// @ts-expect-error: 'archived' is not a status
await postsService.count({ status: 'archived' })
```

## Generic over the result, not over the model

MongoZod has no type for any model with typed reads. Comparing a model with
`Model<any, any, any, any, any>` costs about 57,600 type instantiations with TypeScript 7 and
133,800 with 5.5 the first time. `AnyModel`, the type plugins see, takes and returns the driver's
`Document`, so its reads lose their types. A helper that is generic over what it reads keeps them.

The same goes for a helper that throws when a document is missing:

```ts
export async function orNotFound<T>(read: PromiseLike<T | null>): Promise<T> {

  const found = await read

  if (found === null) throw new Error('not found')

  return found
}

const post = await orNotFound(PostsModel.findOne({ title: 'Hello, MongoDB' }))
// post: the whole post, not null
```

## Common mistakes

- **A repository class over `Model<…>` or `AnyModel`**: the first costs tens of thousands of type
  instantiations, and the second reads `Document`s. Take the query as a callback instead, or write
  a service per model.
- **`Parameters` and `ReturnType` of an operation**: the operations are generic, so
  `Parameters<typeof PostsModel.find>[0]` is `never`, and
  `Awaited<ReturnType<typeof PostsModel.findOne>>` is not what a call returns. Use `FilterOf` and
  `ReadOf`.
- **The driver's `Filter<T>` for a filter**: it accepts filters that don't fit the schema, such as
  an array for a string field. Use `FilterOf` with a `const` generic, which checks each key and
  keeps the editor's suggestions.
