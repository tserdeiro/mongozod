---
title: Populate
description: Declare the references between models and replace the stored ids with the documents they point to.
---

A field that stores the `_id` of another document is a
[reference](https://www.mongodb.com/docs/manual/reference/database-references/). Declare it in the
`references` option of `mongozod()`, and the `populate` option of a read replaces the id with the
document it points to.

```ts
import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const userSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  name: z.string(),

  email: z.email(),

  role: z.enum(['admin', 'author'])
    .default('author')
})

const postSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  title: z.string(),

  body: z.string(),

  status: z.enum(['draft', 'published'])
    .default('draft'),

  tags: z.string()
    .array()
    .default([]),

  authorId: mz.objectId(),

  coauthorIds: mz.objectId()
    .array()
    .default([]),

  revisions: z
    .object({

      editorId: mz.objectId(),

      at: z.date()
    })
    .array()
    .default([])
})

const UsersModel = mongozod({

  collection: 'users',

  db,

  schema: userSchema,

  references: {

    // One-to-many: the posts whose `authorId` stores the `_id` of the user.
    posts: { model: () => PostsModel, foreignField: 'authorId' }
  }
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  references: {

    'authorId': () => UsersModel,

    'coauthorIds': () => UsersModel,

    'revisions.editorId': () => UsersModel
  }
})

const { insertedId: authorId } = await UsersModel.insertOne({
  name: 'Ana',
  email: 'ana@example.com'
})
const { insertedId: postId } = await PostsModel.insertOne({
  title: 'Hello, MongoDB',
  body: 'A first post.',
  authorId
})

const post = await PostsModel.findOne(
  { _id: postId },
  { populate: { authorId: { projection: { name: 1 } } } }
)
// { _id: ObjectId('…'), title: 'Hello, MongoDB', …, authorId: { _id: ObjectId('…'), name: 'Ana' } }
```

The rest of this page uses these models.

## Declare references

`references` maps each reference to its target, which is one of:

- **A function that returns a model**, such as `() => UsersModel`. The function lets two models
  reference each other, as users and posts do above, and a model reference itself, such as the
  `parentId` of a comment that replies to another. `populate` reads through that model, so its
  plugins and its [virtuals](./virtuals.md) apply.
- **`{ collection, schema }`**, for a collection without a model, such as one that another library
  writes. `populate` reads it with the driver: no plugins, no virtuals and no nested `populate`.

```ts separate
import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

// The `user` collection of an auth library, which has no model.
const authUserSchema = z.object({

  _id: z.string(),

  name: z.string(),

  image: z.string()
    .optional()
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: z.object({

    _id: mz.objectId()
      .default(() => new ObjectId()),

    title: z.string(),

    authorId: z.string()
  }),

  references: {

    authorId: { collection: 'user', schema: authUserSchema }
  }
})

const posts = await PostsModel.find({}, { populate: { authorId: { projection: { name: 1 } } } })
// Array<{ _id: ObjectId; title: string; authorId: { _id: string; name: string } | null }>
```

The key of a reference is a path of the schema that stores the `_id` of its target, or an array of
them: a field, or a path through subdocuments and arrays of subdocuments, such as
`revisions.editorId`. It may be in one type of document only, when the schema has
[several](./document-types.md). The [one-to-many](#one-to-many) references and the ones
[in another key](#in-another-key) are the exception: their key is not a field.

A key that is not a path of the schema does not compile, and `mongozod()` throws an `Error` when it
defines the model. So does a path with an array index, such as `revisions.0.editorId`, which would
leave the ids of the other elements as they are, and a path through a `z.record()`, whose keys are
not fields.

The target is checked when you populate, not when you declare it: that is what lets two models
reference each other. A `populate` of a field that stores another type than the `_id` of its target,
such as a string for an `ObjectId`, does not compile: its query would find nothing.

## Populate a read

`populate` goes in the options of `find`, `findOne`, `findOneAndUpdate`, `findOneAndReplace` and
`findOneAndDelete`, the operations that return documents. Each key is a reference of the model, and
its value is `true`, for the whole document as its model reads it, or an object with the options of
its query, named like the driver's `FindOptions`:

| Option       | What it does                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `projection` | The fields of the referenced documents, checked like a projection of their model, its virtuals included.                        |
| `filter`     | Leaves out the documents that don't match: a reference becomes `null`, and an array drops them.                                 |
| `sort`       | Orders an array of references. Without it, an array keeps the order in which it stores the ids.                                 |
| `limit`      | Keeps the first N documents of each array, per document. Only for the references that store an array, and the one-to-many ones. |
| `populate`   | Populates the references of the referenced documents, for [nested levels](#nested-populate).                                    |

Each option is checked against the schema of the target, and the editor suggests its paths. An
unknown option, such as `skip`, does not compile and throws a `ZodError` with the issue at
`['populate', key, option]`.

```ts
const draft = await PostsModel.findOne(
  { _id: postId },
  {
    populate: {
      authorId: true,
      coauthorIds: {
        projection: { name: 1 },
        filter: { role: 'author' },
        sort: { name: 1 },
        limit: 3
      }
    }
  }
)
// draft?.authorId: { _id: ObjectId; name: string; email: string; role: 'admin' | 'author' } | null
// draft?.coauthorIds: Array<{ _id: ObjectId; name: string }>
```

A write that returns its document populates it too, in the same call:

```ts
const published = await PostsModel.findOneAndUpdate(
  { _id: postId },
  { $set: { status: 'published' } },
  { returnDocument: 'after', populate: { authorId: { projection: { name: 1 } } } }
)
```

### The limit is per document

`limit` keeps the first N documents of each array, after the `filter`, in the order of the array or
of the `sort`. A reference that stores a single id takes no `limit`: it does not compile. The value
is a positive integer; another throws a `ZodError`.

Mongoose's `limit` counts the documents of the whole query instead, and its `perDocumentLimit` runs
one query per document
([Mongoose docs](https://mongoosejs.com/docs/populate.html#limit-vs-perDocumentLimit)). In an array
of ids the query already brings every id, so mongozod cuts each array; a one-to-many reference with
a `limit` runs [one query per document](#one-to-many).

## Arrays and subdocuments

A reference that stores an array of ids becomes an array of documents: the ones found, in the order
of the array, or of the `sort`. A path through subdocuments goes through arrays like the path of a
filter, and `populate` replaces the id in each element, with one query for the whole reference:

```ts
const history = await PostsModel.findOne(
  { _id: postId },
  { populate: { 'revisions.editorId': { projection: { name: 1 } } } }
)
// history?.revisions: Array<{ editorId: { _id: ObjectId; name: string } | null; at: Date }>
```

The type of the read follows each path, through every array and object.

## One-to-many

A reference with `foreignField` brings the documents of the target that point to this one, without
storing their ids, like the `posts` of the users above. `localField` is the field of this document
they point to, `_id` unless you pass another: these are the names of MongoDB's
[`$lookup`](https://www.mongodb.com/docs/manual/reference/operator/aggregation/lookup/).

```ts
const ana = await UsersModel.findOne(
  { _id: authorId },
  {
    populate: {
      posts: {
        projection: { title: 1 },
        filter: { status: 'published' },
        sort: { _id: -1 },
        limit: 5
      }
    }
  }
)
// ana?.posts: Array<{ _id: ObjectId; title: string }>, her 5 newest published posts
```

- **The key** is not a field of the schema, because it is not stored: a key that is a field or a
  path does not compile, and `mongozod()` throws an `Error`. The `localField` is a path of the
  schema.
- **The `foreignField`** is a path of the target that stores what the `localField` does, or an
  array of it: `{ model: () => PostsModel, foreignField: 'coauthorIds' }` brings the posts a user
  co-wrote. It is checked when you populate, once the target exists: one that is not a path of
  the target, or that stores another type, does not compile, and one that is not a path throws a
  `ZodError`.
- **The value** is an array in the order of the query, empty when no document points to this one.
- **`limit` needs a `sort`**, because without one MongoDB does not say which documents it keeps:
  a `limit` without a `sort` does not compile and throws a `ZodError`. It runs one query per
  document, in parallel, each with its `limit`.
- **Projections**: when the projection of the read leaves out the `localField`, or the projection
  of the `populate` leaves out the `foreignField`, mongozod asks for it and removes it afterwards. A
  projection of the `populate` that keeps only some elements of the array above the `foreignField`,
  with `$elemMatch`, `$slice` or `$`, does not compile and throws a `ZodError`: the documents the
  other elements point to would be lost.
- **A nested `populate`** cannot populate the `foreignField`, which points back to this document.

## In another key

A reference with `localField` and without `foreignField` populates, in a key that is not stored,
the document whose `_id` the `localField` stores. The `localField` keeps its id, like the `as` of a
`$lookup`:

```ts
const commentSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  postId: mz.objectId(),

  body: z.string()
})

const CommentsModel = mongozod({

  collection: 'comments',

  db,

  schema: commentSchema,

  references: {

    post: { model: () => PostsModel, localField: 'postId' }
  }
})

const comments = await CommentsModel.find(
  { postId },
  { populate: { post: { projection: { title: 1 } } } }
)
// [{ _id, postId, body, post: { _id: ObjectId('…'), title: 'Hello, MongoDB' } }]
```

The value follows what the `localField` stores: a document, or `null` when it is missing, for an
id; an array when it stores an array of ids or its path goes through an array. It takes the same
options, with the `limit` of the arrays. The key is not a field, the `localField` is a path of the
schema, and a projection of the read that leaves out the `localField` asks for it and removes it
afterwards. One that excludes it does not compile and throws a `ZodError`.

To keep the `authorId` of the posts and add an `author`, declare
`author: { model: () => UsersModel, localField: 'authorId' }` instead of
`authorId: () => UsersModel`.

## Nested populate

The `populate` of a reference populates the references of its target, which its model resolves and
checks against its own `references`, at any depth:

```ts
const thread = await CommentsModel.find(
  { postId },
  {
    populate: {
      post: {
        projection: { title: 1, authorId: 1 },
        populate: { authorId: { projection: { name: 1 } } }
      }
    }
  }
)
// thread[0]?.post:
//   { _id: ObjectId; title: string; authorId: { _id: ObjectId; name: string } | null } | null
```

A collection without a model has no references, so its `populate` takes none: it does not compile
and throws a `ZodError`.

## Missing documents

A referenced document that does not exist, or that a plugin of its model hides, such as one that
[`softDelete`](../plugins/soft-delete.md) marked as deleted, becomes `null`, and an array keeps the
documents it finds. The type says so, so the code reaches into it with `?.`:

```ts
const authorName = post?.authorId?.name
// string | undefined
```

A reference that the document does not store, because its field is optional, stays out of the
document.

## With a projection

- **An inclusion** still returns the references you populate: with
  `{ projection: { title: 1 }, populate: { authorId: true } }`, the post has its `_id`, its `title`
  and its `authorId`, populated.
- **An exclusion** that leaves out a reference you populate, or an object above it, does not compile
  and throws a `ZodError`: `populate needs "authorId": the projection excludes it`.
- **The projection of a `populate`** may leave out the `_id`: mongozod asks for it to match each
  document with its reference, and removes it afterwards.

## How it reads

- **One `$in` query per reference and per batch** that the server returns, with each id once, so
  many posts by the same author read that author once. The references of a batch are read in
  parallel. A cursor read with `for await` populates each batch as it arrives. A one-to-many
  reference with a `limit` runs one query per document.
- **Through the model of the target**: its plugins and virtuals apply. The `filter` of the
  `populate` goes in an `$and` with the `$in`, so a `filter` on the `_id` narrows the references
  instead of replacing them.
- **With the session and the context of the read**: inside a transaction, the queries see its
  writes. The plugins of each target validate their part of the `context`, and a read that
  populates a model whose plugins ask for a context in the reads takes it, as
  [Plugins](./plugins.md) explains.
- **Not in `aggregate`**: a pipeline joins collections with `$lookup`, which reads the collection
  directly, without the plugins of its model. See
  [Aggregation](./aggregation.md#lookup-instead-of-populate).

## Types

The type of a read follows its `populate`: each reference becomes its document or `null`, or an
array of documents, with the `projection` and the virtuals of the `populate`. To type a service or
a response with the same document, `ReadOf` takes the same options:

```ts
import type { ReadOf } from 'mongozod'

type PostWithAuthor = ReadOf<
  typeof PostsModel,
  { populate: { authorId: { projection: { name: 1 } } } }
>
```

A `populate` that a client sends, through [`mz.populate`](./endpoint-inputs.md#mzpopulate), may
not ask for every reference, so each one it allows is typed as the document or the id. See
[TypeScript](./typescript.md#types-for-services-and-repositories) for the other exported types.

## Common mistakes

- **Passing a string, as in Mongoose**: `populate: 'authorId'` does not compile and throws a
  `ZodError`. Pass an object: `populate: { authorId: true }`.
- **Reading a populated field without `?.`**: a missing document is `null`, and TypeScript says so.
  Handle it with `?.` or a check, instead of asserting it is there.
- **Storing the id with another type than the `_id` of the target**, such as a string for an
  `ObjectId`: the `populate` does not compile. Store the same type, with
  [`mz.objectId()`](./bson-types.md#objectid) for an `ObjectId`.
- **A `limit` on a reference that stores one id**, or on a one-to-many reference without a `sort`:
  neither compiles. A single id needs no limit, and a one-to-many reference needs a `sort` to say
  which documents it keeps.
- **Excluding the reference in the projection of the read**: the read throws a `ZodError`. Leave it
  in, or use an inclusion, which returns it.
- **Expecting `populate` in `aggregate`**: it has none. Use `$lookup`, and filter in the pipeline
  what the plugins of the other model would hide.
- **Declaring a one-to-many reference with a key that is a field**: it does not compile. Its key is
  a new name, such as `posts`, and the field it matches is its `localField`.
