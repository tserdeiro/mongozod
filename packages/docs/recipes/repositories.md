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

## Options from a router

A service that takes the `sort`, the `populate`, `limit` and `skip` of a list from its router types
them with `FindOptionsOf`, which follows the model, not the router's input. The router passes what
`mz.sort` and `mz.populate` give it, and the server its own sort or limit:

```ts separate
import type { FilterOf, FindOptionsOf, ReadOf } from 'mongozod'

import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const userSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  name: z.string(),

  email: z.email()
})

const UsersModel = mongozod({

  collection: 'users',

  db,

  schema: userSchema
})

const postSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  title: z.string(),

  authorId: mz.objectId(),

  createdAt: mz.date(),

  updatedAt: mz.date()
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  timestamps: true,

  references: {

    authorId: () => UsersModel
  }
})

const listPostsInput = z.object({

  populate: mz.populate({

    authorId: userSchema.pick({ _id: true, name: true })
  }),

  sort: mz.sort(postSchema, { createdAt: true, title: true })
})

export const postsService = {

  /** For the router: the client chooses the sort and what to populate. */
  list<const F extends FilterOf<typeof PostsModel, F>>(
    filter: F,
    options: FindOptionsOf<typeof PostsModel> = {}
  ) {
    const { sort = { createdAt: -1 }, ...rest } = options

    return PostsModel.find(filter, { ...rest, sort })
  },

  /** For the server, which never populates: it reads the ids as they are stored. */
  async byAuthor(authorId: ObjectId): Promise<Array<ReadOf<typeof PostsModel>>> {
    return PostsModel.find({ authorId }, { sort: { createdAt: -1 } })
  }
}

const input = listPostsInput.parse({ populate: { authorId: true }, sort: { title: 1 } })

const posts = await postsService.list({}, { ...input, limit: 20 })
// posts[0].authorId: ObjectId | { _id?: ObjectId; name?: string } | null
```

`FindOptionsOf` is not generic: the read types each reference it allows as its id, the projected
document or `null`, whether the caller populates or not. A server caller that never populates gets
the stored ids from a method of its own, such as `byAuthor` above, instead of narrowing the union.
It leaves the `projection` out: one that is not a literal types every field as optional.

## Method types

A method that passes a filter or an update to the model needs its type parameters, so that the model
checks each key the caller writes. The method types declare them once: given with `satisfies`, an
arrow function takes them, and keeps its own result. It works for an object, a function on its own
and the arrow properties of a class:

```ts separate
import type { FilterMethod, UpdateMethod } from 'mongozod'

import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const noteSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  title: z.string(),

  status: z.enum(['draft', 'published'])
})

const NotesModel = mongozod({

  collection: 'notes',

  db,

  schema: noteSchema
})

type NotesModel = typeof NotesModel

const after = { returnDocument: 'after' } as const

export const notesService = {

  list: (filter, options = {}) => NotesModel.find(filter, options),

  updateMany: (filter, update, options?) => NotesModel.updateMany(filter, update, options),

  updateOne: (filter, update) => NotesModel.findOneAndUpdate(filter, update, after)
} satisfies {

  list: FilterMethod<NotesModel>

  updateMany: UpdateMethod<NotesModel>

  updateOne: UpdateMethod<NotesModel, typeof after>
}

export const listNotes = ((filter, options = {}) =>
  NotesModel.find(filter, options)) satisfies FilterMethod<NotesModel>

export class NotesService {

  list = ((filter, options = {}) =>
    NotesModel.find(filter, options)) satisfies FilterMethod<NotesModel>
}

await notesService.updateOne({ status: 'draft' }, { $set: { status: 'published' } })
// the note after the update, or null

// @ts-expect-error: "titel" is not a path of the document
await notesService.list({ titel: 'Hello' })
```

- **The types**: `FilterMethod`, `UpdateMethod`, `ReplaceMethod`, `BulkWriteMethod`,
  `AggregateMethod` and `DistinctMethod` (see the [API](../api/mongozod.md#types-for-services)).
  `FilterMethod<M, O>` takes the options of a `find` unless you give others, such as those of
  `countDocuments`.
- **The options of an update**: `UpdateMethod<M>` takes the caller's and passes them on,
  `arrayFilters` included. `UpdateMethod<M, typeof after>` takes none and passes its own, such as
  `{ returnDocument: 'after' }` to return the document. Don't merge the two, such as with
  `Object.assign(after, options)`: the update the caller writes and the one the model checks become
  different types, and comparing them costs about 150,000 type instantiations once per program.
- **Optional arguments**: mark them in the arrow too, with `?` or a default, such as
  `options = {}`. An argument that the type does not have, at the end and optional, is fine.
- **`type NotesModel = typeof NotesModel`** next to the model saves the `typeof`.
- **Another shape**, such as a required argument before the filter, a `function` declaration or a
  method of a class: write the type parameters by hand, as in [A service per model](#a-service-per-model).
  Both check the same.

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
