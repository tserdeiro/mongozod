---
title: TypeScript
description: How the schema types filters, updates, projections and sorts, and the types to pass them through services and repositories.
---

The schema types every argument of a model's operations. Filters, updates, projections and sorts
are checked path by path against it, with every MongoDB operator, so a typo or a value of the wrong
type does not compile, and a projection narrows what a read returns.

```ts
import type { Document } from 'mongodb'
import type {
  DocOf,
  FilterOf,
  InsertOf,
  ReadOf,
  ReadOptionsArg,
  SortOf,
  UpdateOf,
  UpdateOptionsArg
} from 'mongozod'

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

  title: z.string()
    .min(1),

  body: z.string()
    .default(''),

  status: z.enum(['draft', 'published'])
    .default('draft'),

  tags: z.string()
    .array()
    .default([]),

  authorId: mz.objectId(),

  views: z.number()
    .int()
    .default(0),

  seo: z.object({

    title: z.string(),

    description: z.string()
      .optional()
  })
    .optional(),

  links: z.object({

    url: z.url(),

    checked: z.boolean()
      .default(false)
  })
    .array()
    .default([]),

  reactions: z.record(z.string(), z.number().int())
    .default({}),

  publishedAt: mz.date()
    .optional()
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  references: {

    authorId: () => UsersModel
  }
})

const published = await PostsModel.find({ 'status': 'published', 'seo.title': { $exists: true } })

// @ts-expect-error: "titel" is not a path of the document
await PostsModel.find({ titel: 'Hello, MongoDB' })
```

The error names the problem, such as `"titel" is not a path of the document` or
`"$regex" only applies to strings`. A filter is checked by its types only, without casting: one
that arrives without types, such as a client's, goes through [`mz.filter`](./endpoint-inputs.md)
first. Updates are also validated at runtime (see [Validation](./validation.md)).

## Writes and reads

Writes take the input of the schema, `z.input`, and reads return its output, `z.output`, with the
`_id`. When the schema does not declare `_id`, it is an `ObjectId`, in reads and in filters:

```ts
const authorId = new ObjectId()

const { document: post } = await PostsModel.insertOne({ title: 'Hello, MongoDB', authorId })
// post: { _id: ObjectId; title: string; body: string; status: 'draft' | 'published'; … }

// @ts-expect-error: title is required
await PostsModel.insertOne({ authorId })
```

`distinct` takes a path of the document and returns the type of its values, with arrays flattened:
`PostsModel.distinct('tags')` gives a `string[]`.

## Filters

Each key of a filter is a path of the document, and each condition has to fit its field:

| Operators                                             | Take                                                                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| A value, `$eq`, `$ne`, `$in`, `$nin`                  | The type of the field, or of its elements in an array. A `RegExp` on strings. `null` only where the field can be missing or `null`. |
| `$gt`, `$gte`, `$lt`, `$lte`                          | Numbers, strings, dates and ids: not booleans or objects.                                                                           |
| `$exists`, `$type`                                    | Any field.                                                                                                                          |
| `$regex`, `$options`                                  | Strings only. `$not` takes operators or a `RegExp`.                                                                                 |
| `$mod`, `$bitsAllSet` and the other bitwise operators | Numbers only, and the bitwise ones also a `Binary`.                                                                                 |
| `$all`, `$size`, `$elemMatch`                         | Arrays only. `$elemMatch` checks the element like a filter.                                                                         |
| `$and`, `$or`, `$nor`                                 | Filters, each checked the same way.                                                                                                 |
| `$expr`, `$jsonSchema`, `$text`, `$where`, `$comment` | What the driver takes.                                                                                                              |

```ts
await PostsModel.find({
  'tags': 'mongodb',
  'views': { $gte: 100 },
  'title': /schema/i,
  'links.url': { $regex: '^https://' },
  '$or': [{ publishedAt: { $lt: new Date() } }, { status: 'draft' }]
})

// @ts-expect-error: a status is 'draft' or 'published'
await PostsModel.find({ status: 'archived' })

// @ts-expect-error: $regex only applies to strings
await PostsModel.find({ views: { $regex: '1' } })
```

The same checks apply to every filter of the model: those of the reads, updates and deletes, the
filters of `bulkWrite`, and the `$match` stages at the start of an `aggregate` pipeline.

### `undefined` and `null`

A key whose value may be `undefined` does not compile: the driver sends it as `null`, which matches
the documents without the field. Leave the key out, or write `null` or `{ $exists: false }` when
that is what you mean:

```ts
async function listPosts(status?: 'draft' | 'published') {

  // @ts-expect-error: the driver would send an undefined status as null
  await PostsModel.find({ status })

  return PostsModel.find({ ...(status && { status }) })
}
```

### No casting

Mongoose casts each value of a filter to the type of its field, such as a string to an `ObjectId`,
and throws a `CastError` when it cannot
([Mongoose docs](https://mongoosejs.com/docs/tutorials/query_casting.html)). A model does not cast
filters at runtime: a value of the wrong type does not compile. Parse what arrives without types,
such as a route parameter, before it reaches the model:

```ts
async function getPost(id: string) {

  // @ts-expect-error: the _id is an ObjectId, and the model does not cast the string
  await PostsModel.findOne({ _id: id })

  return PostsModel.findOne({ _id: mz.objectId().parse(id) })
}
```

For filters that clients send, `mz.filter` parses each value with the schema of its field (see
[Endpoint inputs](./endpoint-inputs.md)).

## Updates

Each path of an update is a path of the document, and each value has to fit its operator and its
field. The runtime applies the same rules (see [Validation](./validation.md#updates)):

| Operators                              | Take                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `$set`, `$setOnInsert`, `$min`, `$max` | The input of the field: an ISO string on a `mz.date()` field compiles.                                       |
| `$unset`                               | Optional fields only. One with `.default()` is not optional.                                                 |
| `$inc`, `$mul`, `$bit`                 | Numbers only. `$inc` and `$mul` also a `Decimal128` field.                                                   |
| `$currentDate`                         | Dates only, with `true` or `{ $type: 'date' }`.                                                              |
| `$push`, `$addToSet`                   | Arrays only, with the input of an element, also in `$each`. `$push` takes `$position`, `$slice` and `$sort`. |
| `$pop`, `$pullAll`                     | Arrays only.                                                                                                 |
| `$pull`                                | Arrays only, with a condition on the element, as `$elemMatch` takes it.                                      |
| `$rename`                              | From an optional field to another that stores the same type.                                                 |

```ts
await PostsModel.updateOne(
  { _id: post._id },
  {
    $set: { 'seo.title': 'Hello', 'publishedAt': '2026-10-12T09:00:00Z' },
    $inc: { views: 1 },
    $push: { tags: { $each: ['mongodb', 'zod'], $slice: -10 } }
  }
)

// @ts-expect-error: "title" is required, so it cannot be unset
await PostsModel.updateOne({ _id: post._id }, { $unset: { title: '' } })

// @ts-expect-error: "tags" is not a number
await PostsModel.updateOne({ _id: post._id }, { $inc: { tags: 1 } })
```

An update names the elements of an array with an index, `$`, `$[]` or `$[id]`. An update that uses
an identifier, `$[id]`, needs `arrayFilters`, whose entries are checked against the elements it
names:

```ts
await PostsModel.updateOne(
  { _id: post._id },
  { $set: { 'links.$[link].checked': true } },
  { arrayFilters: [{ 'link.url': 'https://www.mongodb.com/docs/' }] }
)

// @ts-expect-error: "links.$[link].checked" uses an identifier: pass arrayFilters
await PostsModel.updateOne({ _id: post._id }, { $set: { 'links.$[link].checked': true } })
```

- **The `_id`** is written only by `$setOnInsert`, whole: the server rejects a change of it.
- **Timestamps**: a model with `timestamps` sets `updatedAt`, so an update that writes it does not
  compile (see [Timestamps](./timestamps.md)).
- **Several types of document**: a path has to be in every type the filter allows, so the filter
  fixes the discriminator (see [Document types](./document-types.md)).
- **`undefined`** compiles in an update: the key is dropped and the field keeps its value.

## Projections

A projection narrows the type of what a read returns, as MongoDB answers it:

```ts
const titles = await PostsModel.find({}, { projection: { 'title': 1, 'seo.title': 1 } })
// Array<{ _id: ObjectId; title: string; seo?: { title: string } }>

const withoutBody = await PostsModel.findOne({ _id: post._id }, { projection: { body: 0 } })
// Every field but body, or null
```

A projection includes or excludes fields, with dotted paths or the nested form, such as
`{ seo: { title: 1 } }`. It also takes `$slice` and `$elemMatch` on arrays, the positional `$`,
and `{ $meta: 'textScore' }`, which adds the relevance of a text search as a `number`. The
`project()` of the `find` cursor takes the same and replaces the projection of the options.

What MongoDB accepts but answers differently does not compile: an index, such as `'tags.0'`, a
path that does not exist, inclusion mixed with exclusion other than `_id`, `$slice` on a field that
is not an array, a string value, which MongoDB returns as a literal, or an empty sub-projection such
as `{ seo: {} }`.

```ts
// @ts-expect-error: "title" mixes inclusion and exclusion
await PostsModel.find({}, { projection: { title: 1, body: 0 } })
```

A projection kept in a variable needs `as const`: TypeScript widens its `1` to `number`, which a
projection does not take. One built at runtime, such as one a client sends, is typed as the
driver's `Document`, and then every field of the result is optional:

```ts
const card = { title: 1, tags: 1 } as const
const cards = await PostsModel.find({ status: 'published' }, { projection: card })
// Array<{ _id: ObjectId; title: string; tags: string[] }>

const requested: Document = { title: 1 }
const partial = await PostsModel.find({}, { projection: requested })
// Every field optional
```

## Sorts

A sort is an object whose keys are paths of the document, with `1`, `-1`, `'asc'`, `'desc'`,
`'ascending'`, `'descending'` or `{ $meta: 'textScore' }`. It is checked in the options and in the
cursor:

```ts
await PostsModel.find({ status: 'published' }, { sort: { publishedAt: -1, _id: -1 } })

await PostsModel.find().sort({ 'seo.title': 'asc' })

// @ts-expect-error: sort takes an object such as { createdAt: -1 }, not a string
await PostsModel.find({}, { sort: '-publishedAt' })
```

## Dotted paths

TypeScript does not list every path of the schema: it looks up each key that the code writes, one
segment at a time, as Zod walks a value. So there is no depth limit, and recursive schemas work.

- **Arrays**: filters go through arrays, as MongoDB does, and take indexes: `'links.url'` and
  `'links.0.url'`. Updates do not go through them: they take an index, `$`, `$[]` or `$[id]`, with
  `$` once per path. Projections go through arrays but take no index.
- **Records and catchalls**: their keys are paths too, with the type of their values. A key must be
  a literal, so a key typed `string` does not compile.
- **Computed keys**: TypeScript widens the computed key of an object literal to `string`
  ([microsoft/TypeScript#13948](https://github.com/microsoft/TypeScript/issues/13948)), so
  ``{ [`reactions.${emoji}`]: 1 }`` does not compile. Type the object with the pattern:

```ts
async function react(postId: ObjectId, emoji: string) {

  const reaction: Record<`reactions.${string}`, number> = { [`reactions.${emoji}`]: 1 }

  await PostsModel.updateOne({ _id: postId }, { $inc: reaction })
}
```

Paths stop where the schema has nothing to say about what is inside: a transform or a `z.custom()`.
Under a `z.unknown()` or a `z.any()`, any path goes.

## Editor suggestions

The editor suggests the paths of filters, sorts, projections, `distinct` and updates, the update
operators, and the keys of `populate`. They are computed from the schema up to 6 levels deep, with
`$` and `$[]` on the arrays of updates. A deeper path still compiles, and so does one under a
record or a `z.lazy()`, which the suggestions do not enter.

The query operators, such as `$gte` or `$in`, are not suggested yet: inside a field of a filter,
the editor suggests the members of its type.

## Types for services and repositories

A function that takes or returns what a model reads and writes, such as a service or a repository,
types it from the model:

| Type                    | What it is                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `DocOf<M>`              | A stored document, with its `_id`.                                                                |
| `ReadOf<M, O>`          | What a read returns, given its `projection`, its `populate` and the `filter` that fixes its type. |
| `InsertOf<M>`           | What an insert takes, with the fields that `timestamps` and the plugins fill optional.            |
| `FilterOf<M, F>`        | The constraint of a filter that a function passes to the model.                                   |
| `SortOf<M, Sort>`       | The constraint of a sort that a function passes to the model.                                     |
| `UpdateOf<M, U, F, O>`  | The constraint of an update, given its filter and its options.                                    |
| `ReadOptionsArg<M>`     | The options argument of the reads, with the `context` its plugins ask for.                        |
| `UpdateOptionsArg<M>`   | The options argument of the updates, with the `context` its plugins ask for.                      |
| `Input<S>`, `Output<S>` | The input and the output of a schema.                                                             |

`M` is the type of a model, such as `typeof PostsModel`.

`DocOf` and `ReadOf` type what you read:

```ts
type Post = DocOf<typeof PostsModel>

function excerpt(post: Post) {
  return post.body.slice(0, 140)
}

type PostCard = ReadOf<
  typeof PostsModel,
  { projection: { title: 1; authorId: 1 }; populate: { authorId: { projection: { name: 1 } } } }
>
// { _id: ObjectId; title: string; authorId: { _id: ObjectId; name: string } | null }
```

`InsertOf` types a document to insert:

```ts
function createPost(post: InsertOf<typeof PostsModel>) {
  return PostsModel.insertOne(post)
}
```

`FilterOf`, `SortOf` and `UpdateOf` are constraints of a generic, so that the function keeps the
checks and the suggestions of the model. Declare the generic with `const`, as the model does:

```ts
function countPosts<const F extends FilterOf<typeof PostsModel, F>>(filter: F) {
  return PostsModel.countDocuments(filter)
}

function updatePosts<
  const F extends FilterOf<typeof PostsModel, F>,
  const U extends UpdateOf<typeof PostsModel, U, F>
>(filter: F, update: U) {
  return PostsModel.updateMany(filter, update)
}

function newestPosts<const Sort extends SortOf<typeof PostsModel, Sort>>(sort: Sort) {
  return PostsModel.find({ status: 'published' }, { sort }).limit(10)
}

await countPosts({ tags: 'mongodb' })
await updatePosts({ authorId }, { $set: { status: 'published' } })
await newestPosts({ publishedAt: -1 })

// @ts-expect-error: "titel" is not a path of the document
await countPosts({ titel: 'Hello, MongoDB' })
```

`ReadOptionsArg` passes the options of a read through, such as a `session`, or the `context` that a
plugin asks for, which makes them required:

```ts
async function hasDrafts(authorId: ObjectId, ...options: ReadOptionsArg<typeof PostsModel>) {
  return (await PostsModel.countDocuments({ authorId, status: 'draft' }, ...options)) > 0
}

await hasDrafts(authorId, { maxTimeMS: 1000 })
```

`UpdateOptionsArg` does the same for an update:

```ts
async function publishAll(authorId: ObjectId, ...options: UpdateOptionsArg<typeof PostsModel>) {
  return PostsModel.updateMany({ authorId }, { $set: { status: 'published' } }, ...options)
}

await publishAll(authorId, { upsert: false })
```

A function generic over any model, such as a repository that compares a model with
`Model<any, …>`, is expensive to type check. Make it generic over what it reads instead, with the
query as a callback: see [Repositories](../recipes/repositories.md).

## `exactOptionalPropertyTypes`

MongoZod's types are tested with `exactOptionalPropertyTypes` on. What a `mz.filter()` or
`mz.populate()` schema returns, whose optional keys Zod types with `| undefined`, can be passed to
the operations, and the `projection`, `sort` and `populate` options take `undefined`. A filter key
that you set to `undefined` by hand still does not compile, because the driver would send it as
`null`.

## Type cost

Types like these can make an editor slow. CI compiles a typical project, with its models, reads,
writes and endpoint inputs, with TypeScript 7 and with 5.5, the minimum, and fails when its type
instantiations go over a
[budget](https://github.com/tserdeiro/mongozod/blob/main/packages/mongozod/test/type-cost/budget.json).
A change that raises the cost on purpose raises the budget in the same commit.

## Common mistakes

- **A projection in a variable without `as const`**: its `1` widens to `number` and it does not
  compile. Declare it with `as const`, or type its values as `0 | 1`.
- **A computed key in an object literal**: ``{ [`reactions.${emoji}`]: 1 }`` is typed with a
  `string` key and does not compile. Type the object as ``Record<`reactions.${string}`, number>``.
- **A filter value that may be `undefined`**: it does not compile, because the driver sends it as
  `null`. Leave the key out when there is no value.
- **An id as a string**: a filter on an `ObjectId` field does not take its hex string, and the model
  does not cast it. Parse it with `mz.objectId()`, or with `mz.filter` for client input.
- **A `sort` or `projection` in a string**, as Mongoose takes them
  ([Mongoose docs](https://mongoosejs.com/docs/api/query.html)): they do not compile and throw a
  `ZodError`. Write the object, such as `{ publishedAt: -1 }`.
- **Typing a service's filter as the driver's `Filter<T>`**: it does not check the paths. Take a
  generic constrained with `FilterOf`.
- **`$[id]` without `arrayFilters`**: it does not compile, and the server would reject it. Pass one
  entry per identifier.
