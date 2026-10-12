---
title: Schema patterns
description: Model a tree with a recursive schema, and write to a key of a record that is only known at runtime.
---

Two shapes of document that need a pattern of their own: a schema that contains itself, and a
record whose keys come from the request.

## Recursive schemas

A comment with replies, each with its own replies, is a schema that refers to itself. Declare the
field that recurses with a getter, as
[Zod 4 recommends](https://zod.dev/api#recursive-objects):

```ts
import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const replySchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  body: z.string()
    .min(1),

  get replies() {
    return replySchema
      .array()
      .default([])
  }
})

const commentSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  postId: mz.objectId(),

  body: z.string()
    .min(1),

  replies: replySchema
    .array()
    .default([])
})

const CommentsModel = mongozod({

  collection: 'comments',

  db,

  schema: commentSchema
})

const { document: comment } = await CommentsModel.insertOne({
  postId: new ObjectId(),
  body: 'Great post!',
  replies: [{ body: 'Thanks!' }]
})
```

The getter defers the reference until Zod reads the field, and TypeScript infers the type of each
level. Each write validates what it writes at any depth, and each path is checked against the
schema, as in this reply to the first reply:

```ts
const [first] = comment.replies

if (first) {
  await CommentsModel.updateOne(
    { _id: comment._id },
    { $push: { 'replies.$[reply].replies': { body: 'Glad you liked it.' } } },
    { arrayFilters: [{ 'reply._id': first._id }] }
  )
}
```

The `$push` parses the new reply with `replySchema`, so it gets its `_id` and its empty `replies`.
The editor suggests paths up to 6 levels deep, and deeper ones still compile.

`sync()` with `jsonSchema` gives the field that recurses no rule: MongoDB's `$jsonSchema` has no
`$ref` to point back to the schema. See [Sync](../guides/sync.md).

When TypeScript can't infer the type of a getter, it reports that the getter implicitly has type
`any` (TS7023): annotate the return type of the getter, as Zod's docs show. Prefer getters to the
Zod 3 pattern of `z.lazy()` with a `z.ZodType<T>` annotation, which hides the shape from
MongoZod's types: a path into the field, such as `'replies.body'`, doesn't compile.

## A dynamic key of a record

A record stores keys that the schema doesn't name, such as the count of each reaction to a post:

```ts
const postSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  title: z.string()
    .min(1),

  reactions: z.record(z.string(), z.number().int().min(0))
    .default({})
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema
})

const { document: post } = await PostsModel.insertOne({ title: 'Hello, MongoDB' })
```

A path under a record compiles with any key, with the type of its values: `'reactions.tada'`
takes a number. When the key is in a variable, though, TypeScript widens the computed key to
`string`, which is not a path (see [TypeScript](../guides/typescript.md#dotted-paths)):

```ts
async function addReaction(postId: ObjectId, reaction: string) {
  // @ts-expect-error: the key is typed as a string, which is not a path
  await PostsModel.updateOne({ _id: postId }, { $inc: { [`reactions.${reaction}`]: 1 } })
}
```

Type the object with the pattern instead:

```ts
async function react(postId: ObjectId, reaction: string) {

  const inc: Record<`reactions.${string}`, number> = { [`reactions.${reaction}`]: 1 }

  await PostsModel.updateOne({ _id: postId }, { $inc: inc })
}

await react(post._id, 'tada')
```

The same works in filters and in the other update operators, such as `$unset`, which removes a key
of the record:

```ts
const reaction = 'tada'

const popular: Record<`reactions.${string}`, { $gte: number }> = {
  [`reactions.${reaction}`]: { $gte: 10 }
}

const posts = await PostsModel.find(popular)

const unset: Record<`reactions.${string}`, ''> = { [`reactions.${reaction}`]: '' }

await PostsModel.updateOne({ _id: post._id }, { $unset: unset })
```

The runtime validates each value with the schema of the record's values. Validate a key that a
client sends before you build the path with it, such as with `z.string().regex(/^[a-z_]+$/)`: a
`.` in it makes a deeper path, which the update rejects as not a path of the document, and a key
that starts with `$` makes the update throw a `ZodError`, as it does in an insert.

## Common mistakes

- **A recursive schema with `z.lazy()` and `z.ZodType<T>`**: the paths inside it don't compile.
  Use a getter.
- **``{ [`reactions.${key}`]: 1 }`` written inline**: TypeScript types the key as `string`, so the
  update doesn't compile. Declare the object with a pattern type, such as
  ``Record<`reactions.${string}`, number>``.
- **A key from a client used as is**: a `.` makes a deeper path, and a `$` at its start makes the
  update throw. Validate it first.
