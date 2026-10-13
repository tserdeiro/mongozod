---
title: Pagination
description: Page through a collection with mz.after, the keyset pagination of MongoDB's range queries, or with skip and limit.
---

Each page is a new query. For infinite scroll and "next" buttons, `mz.after` turns the last
document of a page into the filter of the next one, the range queries that the MongoDB manual
recommends over `skip`. For tables with numbered pages, `skip` and `limit` work as in the driver.

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

  status: z.enum(['draft', 'published'])
    .default('draft'),

  tags: z.string()
    .array()
    .default([]),

  createdAt: mz.date(),

  updatedAt: mz.date()
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  timestamps: true,

  indexes: (index) => [
    index({ createdAt: -1, _id: -1 })
  ]
})

const listPostsInput = z.object({

  after: mz.after(postSchema, { createdAt: -1, _id: -1 }),

  limit: z.number()
    .int()
    .min(1)
    .max(100)
    .default(20)
})

export async function listPosts(body: unknown) {

  const { after, limit } = listPostsInput.parse(body)

  return PostsModel.find(after, { sort: { createdAt: -1, _id: -1 }, limit })
}
```

The first request sends no `after`. Each next one sends the sort values of the last post it got,
as JSON gives them:

```json
{ "after": { "createdAt": "2026-10-12T09:00:00.000Z", "_id": "6a0c3f9e1d2a34b5c6d7e8f1" } }
```

## Why not the driver's cursor

The driver's cursor lives on the MongoDB server, which closes it when it sits idle, and with several
instances of your server the next request may reach another one. A page has to be a query of its
own.

With `skip`, the server scans from the start of the results on every page, so
[`skip()` gets slower as the offset grows](https://www.mongodb.com/docs/manual/reference/method/cursor.skip/).
A range query starts where the last page ended and uses the index of the sort.

## What `mz.after` builds

`mz.after(schema, sort)` takes the sort of the list. The client sends the value of each sort field
of the last document, and the router gets the filter of the documents after it, in that order:

```ts
const postsAfter = mz.after(postSchema, { createdAt: -1, title: 1, _id: -1 })

postsAfter.parse({
  createdAt: '2026-10-12T09:00:00Z',
  title: 'Hello, MongoDB',
  _id: '6a0c3f9e1d2a34b5c6d7e8f1'
})
// { $or: [
//   { createdAt: { $lt: 2026-10-12T09:00:00.000Z } },
//   { createdAt: 2026-10-12T09:00:00.000Z, title: { $gt: 'Hello, MongoDB' } },
//   { createdAt: 2026-10-12T09:00:00.000Z, title: 'Hello, MongoDB', _id: { $lt: ObjectId('6a0c…') } }
// ] }
```

A document comes after the last one when it equals it on the first fields of the sort and passes it
on the next one: with `$lt` on a field sorted with `-1`, and with `$gt` on one sorted with `1`.

Each value is parsed with the schema of its field. With
[`mz.date()` and `mz.objectId()`](./bson-types.md), the ISO string and the hex string that JSON
gives become a `Date` and an `ObjectId`, so the client sends back what it received. The input takes
exactly the fields of the sort: a missing one, or one more, fails.

## The sort

`mz.after` checks the sort when it is declared, because MongoDB would otherwise repeat or skip
documents between pages:

- **It ends with `_id`**, a unique field that breaks ties. Without one, documents with the same
  `createdAt` could land on two pages or on none. The types ask for `_id`, but they don't see the
  order of the keys of an object, so the runtime checks that it comes last.
- **Its fields are required and not nullable.** MongoDB
  [sorts a missing or `null` value before any other](https://www.mongodb.com/docs/manual/reference/bson-type-comparison-order/),
  and a `$lt` on a date never reaches it, so those documents would never show up.
- **Its fields hold one value, outside arrays.** MongoDB sorts an array by one of its elements, and a
  range matches it when any element passes, so a document could show up twice or never.
- **Each direction is `1` or `-1`.**

What breaks a rule doesn't compile, and throws an `Error` when the schema is built:

```ts
// @ts-expect-error: the sort ends with _id
mz.after(postSchema, { createdAt: -1 })

// @ts-expect-error: "tags" is an array: mz.after sorts by fields of one value
mz.after(postSchema, { tags: 1, _id: 1 })
```

`mz.after(postSchema, { _id: -1, createdAt: -1 })` compiles and throws
`mz.after: the sort ends with _id, which breaks ties`.

The `find` sorts the same way, and nothing checks that the two match. Keep the sort in one constant:

```ts
const newestFirst = { createdAt: -1, _id: -1 } as const

const feedInput = z.object({

  after: mz.after(postSchema, newestFirst),

  limit: z.number()
    .int()
    .min(1)
    .max(100)
    .default(20)
})

export async function feed(body: unknown) {

  const { after, limit } = feedInput.parse(body)

  return PostsModel.find(after, { sort: newestFirst, limit })
}
```

Declare an index with the keys of the sort, such as `index({ createdAt: -1, _id: -1 })`, and run
[`sync()`](./sync.md): the sort and the ranges use it.

## With other filters

`mz.after` gives a filter, so the router joins it with the client's filter and its own scope with
`$and`:

```ts
const publishedInput = z.object({

  after: mz.after(postSchema, newestFirst),

  filter: mz
    .filter(postSchema, {
      tags: ['$in']
    })
    .default({}),

  limit: z.number()
    .int()
    .min(1)
    .max(100)
    .default(20)
})

export async function listPublished(body: unknown) {

  const { after, filter, limit } = publishedInput.parse(body)

  return PostsModel.find(
    { $and: [filter, after, { status: 'published' }] },
    { sort: newestFirst, limit }
  )
}
```

A client that sends no `after` gets `{}`, the first page, so the router needs no fallback. See [Endpoint inputs](./endpoint-inputs.md#a-list-and-a-findone) for a complete list
endpoint.

The key of the input is yours. With tRPC, call it `cursor`: its
[`useInfiniteQuery`](https://trpc.io/docs/client/react/useInfiniteQuery) needs a procedure that
takes a `cursor` input.

## Numbered pages

For a table where the user jumps to page 7, use `skip` and `limit`. They are options of the driver,
which the model passes as they are, and a client sends a number, which needs no builder:

```ts
const tableInput = z.object({

  page: z.number()
    .int()
    .min(1)
    .max(500)
    .default(1),

  pageSize: z.number()
    .int()
    .min(1)
    .max(100)
    .default(20)
})

export async function postsTable(body: unknown) {

  const { page, pageSize } = tableInput.parse(body)

  const [rows, total] = await Promise.all([
    PostsModel.find({}, { sort: newestFirst, skip: (page - 1) * pageSize, limit: pageSize }),
    PostsModel.countDocuments({})
  ])

  return { rows, total }
}
```

The `.max()` of `page` matters: MongoDB reads every document a `skip` passes over, so a client that
asks for page 1,000,000 makes the server read the whole collection.

The cursor of `find` also chains them, as the driver's does:
`PostsModel.find({}).sort(newestFirst).skip(40).limit(20)`.

Besides getting slower as the offset grows, `skip` counts positions: a post published or deleted
while the user pages shifts the later pages by one, so a row repeats or goes missing. A range query
starts after a document, so the others don't move it.

## Common mistakes

- **Sorting the `find` differently from `mz.after`**: the pages repeat or skip documents, without an
  error. Share one constant between both.
- **Letting the client choose the sort of a keyset list**: the sort of `mz.after` is fixed when the
  endpoint declares it, so a client's `mz.sort` that differs from it breaks the pages. Declare one
  list per order, or use `skip` for a table the client sorts.
- **Sorting by an optional or nullable field**: it doesn't compile, and throws. Make the field
  required and not nullable, with a `.default()` if writes may leave it out.
- **Declaring the date as `z.date()`**: the ISO string the client sends back fails. Use `mz.date()`.
- **Sending the whole document as `after`**: the input takes only the fields of the sort, so the
  others fail. Send `{ createdAt, _id }`.
- **Using `skip` for infinite scroll**: it gets slower with each page, and new documents shift the
  pages. Use `mz.after`.
