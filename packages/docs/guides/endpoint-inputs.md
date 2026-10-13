---
title: Endpoint inputs
description: Accept MongoDB filters, updates, sorts, projections and populate from clients, limited to what each endpoint declares.
---

An endpoint that lists or edits documents takes a filter, a sort or an update from its client. The
builders of `mongozod/mzod` make that input from the document's schema: the client sends MongoDB
syntax, and each endpoint declares what it accepts. Anything else fails with a `ZodError`, and each
value is parsed with the schema of its field.

Given a model of posts:

```ts
import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const userSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  name: z.string()
    .min(1),

  email: z.email()
})

const postSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  title: z.string()
    .min(1),

  body: z.string()
    .default(''),

  summary: z.string()
    .optional(),

  status: z.enum(['draft', 'published'])
    .default('draft'),

  tags: z.string()
    .array()
    .default([]),

  authorId: mz.objectId(),

  createdAt: mz.date(),

  updatedAt: mz.date()
})

const UsersModel = mongozod({

  collection: 'users',

  db,

  schema: userSchema
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  timestamps: true,

  indexes: (index) => [
    index({ createdAt: -1, _id: -1 }),
    index({ title: 'text', body: 'text' })
  ],

  references: {

    author: {

      localField: 'authorId',

      model: () => UsersModel
    }
  }
})
```

An endpoint that lists them declares what its client can send:

```ts
const listPostsInput = z.object({

  filter: mz
    .filter(postSchema, {
      tags: ['$in', '$all'],
      createdAt: ['$gte', '$lt']
    })
    .default({}),

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

// The body of a request
const input = listPostsInput.parse({
  filter: { tags: { $in: ['mongodb'] }, createdAt: { $gte: '2026-01-01T00:00:00Z' } },
  sort: { title: 1 }
})
// { filter: { tags: { $in: ['mongodb'] }, createdAt: { $gte: 2026-01-01T00:00:00.000Z } },
//   sort: { title: 1 }, limit: 20 }

const posts = await PostsModel.find(input.filter, { sort: input.sort, limit: input.limit })

listPostsInput.parse({ filter: { $where: 'sleep(1000)' } })
// ZodError: Unrecognized key: "$where"
```

## The approach

Each builder returns a Zod schema, which you nest in a `z.object` like any other: the input of an
HTTP handler, a tRPC procedure or a server action. What it gives you is MongoDB syntax, ready for
the model.

- **An allow list per endpoint**: each builder takes the fields, and for filters the operators,
  that the endpoint accepts. A `$where`, an operator or a field it doesn't declare fails.
- **Values parsed by their field**: each value goes through the schema of its field, without its
  default. With [BSON field types](./bson-types.md), an ISO date becomes a `Date` and a hex string
  an `ObjectId`.
- **Checked declarations**: a path that doesn't exist, or an operator that doesn't apply to its
  field, doesn't compile. Most of these mistakes also throw an `Error` that names the builder when
  the schema is built.
- **No defaults of their own**, but for `mz.projection`, whose missing value is the mask: you
  decide with Zod's methods what happens when the client sends nothing (see
  [Defaults and required fields](#defaults-and-required-fields)).
- **Client-safe**: `mongozod/mzod` never imports the driver, so the same input schemas run in web and
  React Native clients, such as to type a form.

Keys set to `undefined` are dropped, because the driver would send them as `null`. JSON never sends
them and superjson does, so a request means the same with both.

The builders take Zod and Zod Mini schemas, and a `z.discriminatedUnion` at the root, which looks
for each field in its types. They build classic Zod schemas.

What the builders protect against, and what stays with your application, such as authorization and
the cost of a query, is in [Security](./security.md).

## Importing `mz`

Import it as a namespace, next to Zod's `z`:

```ts separate
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const tagsSchema = z.object({

  tags: z.string()
    .array()
})

const tagsFilter = z.object({

  filter: mz.filter(tagsSchema, {

    tags: ['$in']
  })
})
```

`mongozod/mzod` has only named exports, so a bundler keeps the builders and field types a file uses
and drops the rest. There is no `mz` object to import by name: an object would bring every builder
into the client's bundle. It doesn't re-export Zod either, so each file keeps its own `z`.

`import { filter, sort } from 'mongozod/mzod'` works too, but names such as `filter`, `update` and
`sort` clash with common variables.

## `mz.filter`

`mz.filter(schema, fields)` takes each path with the operators the client can use on it:

```ts
const postsFilter = mz.filter(postSchema, {

  _id: ['$eq', '$in'],

  title: ['$regex'],

  status: ['$eq', '$ne'],

  tags: ['$eq', '$all', '$size']
})

postsFilter.parse({
  _id: { $in: ['65c3b9b4f1d2a34b5c6d7e8f'] },
  title: { $regex: '^hello', $options: 'i' },
  tags: 'mongodb'
})
// { _id: { $in: [ObjectId('65c3b9b4f1d2a34b5c6d7e8f')] },
//   title: { $regex: '^hello', $options: 'i' }, tags: 'mongodb' }
```

- **Operators**: `$eq`, `$ne`, `$in`, `$nin`, `$gt`, `$gte`, `$lt`, `$lte`, `$exists` and
  `$regex`, with `$options`, and for arrays `$all`, `$size` and `$elemMatch`.
- **Where they apply**: the ranges compare numbers, strings, dates and ids, `$regex` applies to
  strings, and `$all`, `$size` and `$elemMatch` to arrays. The editor suggests the paths and, on
  each one, its operators.
- **Equality**: a field that declares `$eq` also takes the value alone, as in MongoDB. On an array,
  an equality takes an element or the whole array, and the ranges compare its elements.
- **An object of operators** has one at least: `{}` would be an equality with an empty object.
- **`$options`** goes only with `$regex`: MongoDB rejects it alone.
- **`$regex`** takes any pattern the client sends, and one that isn't anchored to the start reads
  the whole collection or index. For a search box, prefer `$text` or Atlas Search (see
  [Security](./security.md#cost)).
- **Dotted paths** into subdocuments, such as `'address.city'`, work as in a model's filter.

```ts
// @ts-expect-error: "$regex" only applies to strings
mz.filter(postSchema, { createdAt: ['$regex'] })

// @ts-expect-error: "titel" is not a path of the document
mz.filter(postSchema, { titel: ['$eq'] })
```

### `$elemMatch`

On an array of objects, `$elemMatch` takes the paths declared under the array, relative to its
elements, as in MongoDB:

```ts
const commentSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  postId: mz.objectId(),

  body: z.string(),

  reactions: z.object({

    userId: mz.objectId(),

    kind: z.enum(['like', 'love'])
  })
    .array()
    .default([])
})

const commentsFilter = mz.filter(commentSchema, {

  'postId': ['$eq'],

  'reactions': ['$elemMatch'],

  'reactions.userId': ['$eq'],

  'reactions.kind': ['$eq', '$in']
})

commentsFilter.parse({
  reactions: { $elemMatch: { userId: '65c3b9b4f1d2a34b5c6d7e8f', kind: { $in: ['like', 'love'] } } }
})
```

`reactions.userId` also works at the top level. On an array of values, such as
`scores: ['$elemMatch', '$gte', '$lt']`, `$elemMatch` takes the operators the field declares for
its elements. Without anything declared for the elements, it doesn't compile.

## `mz.update`

`mz.update(schema, operators)` takes `$set`, `$unset` and `$inc`, each with the paths the client
can write:

```ts
const updatePostInput = z.object({

  filter: mz
    .filter(postSchema, {
      _id: ['$eq']
    })
    .required({ _id: true }),

  update: mz.update(postSchema, {

    $set: ['title', 'body', 'summary', 'tags', 'status'],

    $unset: ['summary']
  })
})

declare const session: { userId: ObjectId }

const edit = updatePostInput.parse({
  filter: { _id: '65c3b9b4f1d2a34b5c6d7e8f' },
  update: { $set: { title: 'Hello again' }, $unset: { summary: '' } }
})

await PostsModel.updateOne({ $and: [edit.filter, { authorId: session.userId }] }, edit.update)
```

The client's filter picks the post, and the scope from the session decides whether this user may
edit it: without it, any user could edit any post by its `_id`. The builders limit what a client
can express, not which documents it may touch (see [Security](./security.md)).

- **No defaults**: an update keeps what the client sent. Setting `title` doesn't reset `body` to its
  default, `''`.
- **`$unset`** takes optional fields only, and **`$inc`** numbers, integers when the field is an
  integer, or a [`mz.decimal128()`](./bson-types.md#decimal128), which takes the string of an
  amount.
- **Paths outside arrays**: no indexes and no positional operators. Those name an element, which
  the router decides, with `arrayFilters` if needed.
- **The `_id` is immutable**: declaring it doesn't compile and throws.
- **Timestamps**: don't declare `createdAt` or `updatedAt` when the model has
  [timestamps](./timestamps.md). The model sets them and rejects them in an update.
- **At least one operator**: an update without operators fails, as in the driver. `{ $set: {} }`
  passes, since MongoDB takes it and changes nothing.

The values are parsed with the schema of their field, refinements included, and the model
validates them again when it writes. See [Validation](./validation.md).

```ts
// @ts-expect-error: "title" is required, so it cannot be unset
mz.update(postSchema, { $unset: ['title'] })

// @ts-expect-error: "title" is not a number
mz.update(postSchema, { $inc: ['title'] })
```

## `mz.sort`

`mz.sort(schema, mask)` takes the paths the client can sort by, as a mask like Zod's `.pick()`. The
client sends `1` or `-1` for each:

```ts
const postsSort = mz
  .sort(postSchema, {
    createdAt: true,
    title: true
  })
  .default({ createdAt: -1 })

postsSort.parse({ title: 1, createdAt: -1 })
// { title: 1, createdAt: -1 }
```

It keeps the order in which the client sends the keys, which decides what sorts first. `$meta`,
and a string such as `'-createdAt'`, fail.

## `mz.projection`

`mz.projection(schema, mask)` takes the paths the client can ask for, with `1` or `true` to include
and `0` or `false` to exclude, without mixing both, except for `_id`. The mask is the most a client
gets: the router always receives an inclusion of declared paths.

```ts
const postsProjection = mz.projection(postSchema, {

  title: true,

  summary: true,

  tags: true
})

postsProjection.parse({ title: 1, summary: true })
// { title: 1, summary: 1 }
postsProjection.parse({ tags: 0 })
// { title: 1, summary: 1 }
postsProjection.parse({})
// { title: 1, summary: 1, tags: 1 }
```

MongoDB reads an exclusion such as `{ tags: 0 }`, and `{}`, as the whole document, with the fields
the mask leaves out. So an exclusion means the declared paths but those, and nothing means all of
them. Excluding every declared path leaves the `_id`, which MongoDB returns unless the client sends
`_id: 0`. A mask can't declare a path and a path inside it, such as `author` and `author.name`,
because MongoDB rejects both in one projection.

A client that sends no projection gets the mask too, so its key is optional in an input. Don't add
`.optional()`: Zod returns `undefined` without running the builder, and a model without a
projection reads the whole document.

The model doesn't know at compile time whether a projection that arrives at runtime includes or
excludes, so the read types each projected field as optional. To let a client ask for a
[virtual](./virtuals.md), pass a schema that adds it, such as
`mz.projection(userSchema.extend({ displayName: z.string() }), { name: true, displayName: true })`.

## `mz.populate`

`mz.populate(whitelists)` takes the [references](./populate.md) a client can expand, each with the
fields it can see, as a schema picked from the referenced one. Here `author` is the reference
of the model above, the user whose `_id` `authorId` stores (see
[In another key](./populate.md#in-another-key)):

```ts
const authorPopulate = mz.populate({

  author: userSchema.pick({ _id: true, name: true })
})

authorPopulate.parse({ author: true })
// { author: { projection: { _id: 1, name: 1 } } }

authorPopulate.parse({ author: { name: 1 } })
// { author: { projection: { name: 1 } } }
```

The client sends `true` for the whole whitelist, never the whole document, or `1` or `true` for some
of its fields. `{}`, an exclusion, a field outside the whitelist or a reference not declared fail.
The router gets the `populate` option of the model, with a `projection`. The client never sends a
`filter` or a `sort`: those belong to the endpoint.

In the result, the populated field is typed as the id or the referenced document, with each of its
fields optional, since the model doesn't know at compile time what the client asks for.

## `mz.after`

`mz.after(schema, sort)` turns the last document of a page into the filter of the next one. See
[Pagination](./pagination.md).

## Defaults and required fields

The builders return schemas without defaults, but for `mz.projection`. Zod's methods decide what an
endpoint does when the client sends nothing:

- **A list** takes `.default({})` on `mz.filter` and `mz.after`, so the router joins filters with
  `$and` and needs no `?? {}`.
- **A filter by id** takes `.required({ _id: true })`. Without it, `{}` is a valid filter, and
  `findOne`, `updateOne` or `deleteOne` would act on whatever document comes first.
- **At least one of several fields** takes a `.refine()`.
- **`sort` and `populate`** take `.optional()` or a default, such as
  `.default({ createdAt: -1 })`.
- **`projection`** needs nothing: a missing one is the mask.

```ts
const findPostInput = z.object({

  filter: mz
    .filter(postSchema, {
      _id: ['$eq']
    })
    .required({ _id: true })
})

findPostInput.parse({ filter: {} })
// ZodError: Invalid input: expected nonoptional, received undefined, at filter._id

const findByTitleOrId = mz
  .filter(postSchema, {
    _id: ['$eq'],
    title: ['$eq']
  })
  .refine((filter) => Object.keys(filter).length > 0, 'pass _id or title')
```

The values never get the defaults of the document's schema: the `.default()` of `_id` would turn a
missing id into a new one, which matches nothing.

`mz.filter` returns a `z.strictObject`, so `.required()`, `.refine()`, `.default()` and `.extend()`
work. `.pick()`, `.omit()` and `.partial()` throw: declare another `mz.filter` instead.

## `$and`, `$or` and `$nor`

`mz.filter` takes only the declared fields. An endpoint that lets the client combine conditions adds
the logical operators with `.extend()`, with the same allow list inside them and a limit on their
length:

```ts
const userConditions = mz.filter(userSchema, {
  name: ['$eq', '$regex'],
  email: ['$eq']
})

const usersFilter = userConditions.extend({

  $or: userConditions
    .array()
    .max(5)
    .optional()
})

usersFilter.parse({ $or: [{ name: { $regex: '^Ana' } }, { email: 'ana@example.com' }] })
```

A getter that returns the filter itself, such as `get $or() { return usersFilter.array() }`,
nests them at every level, without a limit on how deep.

They are not accepted by default because they cost:
[a `$or` uses indexes](https://www.mongodb.com/docs/manual/reference/operator/query/or/) only when
each of its clauses has one, and scans the collection otherwise. A client could turn a filter by
`_id` into a full scan, and nest them without a limit. Add them where the endpoint needs them.

## `$where` and `$expr`

`$where` and `$expr` are never exposed to clients. `mz.filter` rejects them, and they can't be
declared:

```ts
// @ts-expect-error: "$where" is not an operator of mz.filter
mz.filter(postSchema, { title: ['$where'] })
```

[`$where`](https://www.mongodb.com/docs/manual/reference/operator/query/where/) runs JavaScript on
the server, and `$expr` takes aggregation expressions over any field of the document, so neither
fits an allow list. When an endpoint needs one, the router writes it.

## A list and a findOne

A complete endpoint for the posts of a blog, with keyset pagination, a search term and the author.
In a project, the inputs go in a file that imports no model, so a client can use them too:

```ts
/** Turns the search term into MongoDB's text search, which needs a text index. */
function textSearch(term?: string) {

  if (!term) return {}

  return { $text: { $search: term } }
}

const authorInput = mz
  .populate({
    author: userSchema.pick({ _id: true, name: true })
  })
  .optional()

export const listPostsSchema = z.object({

  after: mz
    .after(postSchema, { createdAt: -1, _id: -1 })
    .default({}),

  filter: mz
    .filter(postSchema, {
      _id: ['$eq', '$in'],
      authorId: ['$eq'],
      tags: ['$in', '$all']
    })
    .default({}),

  limit: z.number()
    .int()
    .min(1)
    .max(100)
    .default(20),

  populate: authorInput,

  term: z.string()
    .max(100)
    .optional()
    .transform(textSearch)
})

export const findOnePostSchema = z.object({

  filter: mz
    .filter(postSchema, {
      _id: ['$eq']
    })
    .required({ _id: true }),

  populate: authorInput
})
```

The router gets inputs that are already filters, so it joins them with `$and` and adds its own
scope, here the published posts:

```ts
export async function listPosts(input: z.output<typeof listPostsSchema>) {
  return PostsModel.find(
    { $and: [input.filter, input.after, input.term, { status: 'published' }] },
    { limit: input.limit, populate: input.populate, sort: { createdAt: -1, _id: -1 } }
  )
}

export async function findOnePost(input: z.output<typeof findOnePostSchema>) {
  return PostsModel.findOne(
    { $and: [input.filter, { status: 'published' }] },
    { populate: input.populate }
  )
}
```

A client sends, for example,
`{ "filter": { "tags": { "$in": ["mongodb"] } }, "populate": { "author": { "name": 1 } } }`, and the
router gets `populate: { author: { projection: { name: 1 } } }`. For the next page, it also sends
the `createdAt` and `_id` of the last post it got. Validate the request body with
`listPostsSchema.parse(body)`, or let your framework do it, as tRPC does with `.input()`.

## Common mistakes

- **`.optional()` on `mz.projection`**: a client that sends no projection gets the whole document,
  with the fields the mask leaves out. Leave it as it is: a missing projection is the mask.
- **A filter by id without `.required({ _id: true })`**: a request without `_id` gives `{}`, which
  matches any document, so an update or a delete acts on the first one. Require the fields that
  identify the document.
- **Expecting the defaults of the document's schema**: a value missing from an input stays missing.
  Defaults belong to inserts.
- **Calling `.pick()`, `.omit()` or `.partial()` on `mz.filter`**: they throw. Declare another
  `mz.filter` with the fields you want.
- **Sending the input in a query string**: `?limit=10` arrives as the string `'10'`, and the input
  doesn't coerce it, so it fails. Send the input as JSON, in the body of a POST or in one query
  parameter that the handler parses with `JSON.parse` (see [HTTP APIs](../recipes/http-apis.md)).
- **Declaring a date as `z.date()` in the document's schema**: the ISO string a client sends fails
  in `mz.filter`, `mz.update` and `mz.after`. Use [`mz.date()`](./bson-types.md#dates), and
  `mz.objectId()` for ids, which turns the client's hex string into an `ObjectId`.
- **Declaring `createdAt` or `updatedAt` in `mz.update` on a model with timestamps**: the input
  compiles, but passing its output to the model doesn't, and at runtime the model throws a
  `ZodError`.
- **Spreading the client's filter over your scope**: `{ ...scope, ...input.filter }` lets the
  client replace a key of the scope. Join them with `$and`.
