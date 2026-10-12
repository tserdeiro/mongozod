---
title: Schema migrations
description: Add a field or a virtual to a collection that already has documents, and list the documents that don't fit first.
---

Reads are not validated: a model returns what is stored, typed with the schema. When the schema
changes, the documents written before may not fit it, and their types are wrong until you migrate
them with an update.

## Add a field with a default

A `.default()` fills the field on inserts and on the documents an upsert creates, not on the
documents already stored: a read returns what is stored, as Mongoose's `lean()` does, which skips
defaults ([Mongoose docs](https://mongoosejs.com/docs/tutorials/lean.html#plugins)). Reads type
`tags` as `string[]` from the start, so `post.tags.length` throws on an old post until it is
migrated. Deploy the schema, so that new posts have the field, and migrate the old ones:

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

  body: z.string(),

  // New: posts written before don't have these.
  tags: z.string()
    .array()
    .default([]),

  excerpt: z.string()
    .default(''),

  createdAt: mz.date(),

  updatedAt: mz.date()
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  timestamps: true
})

const { modifiedCount } = await PostsModel.updateMany(
  { tags: { $exists: false } },
  { $set: { tags: [] } },
  { timestamps: false }
)
```

The update is validated like any other. `timestamps: false` keeps the `updatedAt` of each post,
since the migration doesn't change what the post says.

When the new value depends on each document, use an update with a pipeline. Its values are
expressions that the server computes, so the schema doesn't validate them:

```ts
await PostsModel.updateMany(
  { excerpt: { $exists: false } },
  [{ $set: { excerpt: { $substrCP: ['$body', 0, 140] } } }],
  { updatePipeline: true, timestamps: false }
)
```

## List the documents that don't fit

Before you make the schema stricter, parse what is stored with `safeParse` and list what fails. Read
with the driver's collection, which returns the documents as stored:

```ts
for await (const post of PostsModel.collection.find()) {

  const result = postSchema.safeParse(post)

  if (!result.success) console.log(post._id.toHexString(), z.prettifyError(result.error))
}
// 6acd… ✖ Invalid input: expected string, received undefined
//   → at body
```

Use `safeParseAsync` when the schema has async refinements or transforms. Count each case with a
filter before deciding how to migrate it, such as `{ body: { $exists: false } }`.

If the model applies a [`$jsonSchema`](../guides/sync.md),
`jsonSchema: { validationLevel: 'moderate' }` lets the server keep updating the documents that
don't pass it, so the migration can run. Switch to `true`, which is `'strict'`, once every document
fits.

## Add a virtual

A virtual computes its value from fields of the document, with its own schema, on every read. If a
stored document doesn't pass that schema, the read throws a `ZodError`, so one old document breaks
every `find` that reaches it. Check what is stored against the virtual's schema before you deploy
it:

```ts
const userSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  firstName: z.string(),

  // New: users written before only have `firstName`.
  lastName: z.string()
})

const fullName = userSchema.pick({ firstName: true, lastName: true })
  .transform((user) => `${user.firstName} ${user.lastName}`)

const UsersModel = mongozod({

  collection: 'users',

  db,

  schema: userSchema,

  virtuals: {

    fullName
  }
})

for await (const user of UsersModel.collection.find()) {
  if (!fullName.safeParse(user).success) console.log(user._id)
}
```

Then migrate those documents, or give the field a `.default()`: the virtual's schema applies it to
a document without the field, so `lastName: z.string().default('')` lets the old users through.

## Common mistakes

- **Reading the new field before migrating**: the type says it's there, and it's `undefined` on
  every old document. Migrate them, or treat it as optional until you do.
- **Adding a virtual without checking the stored documents**: one document that doesn't pass it
  makes every read that reaches it throw. List them with `safeParse` first.
- **Listing them with the model's `find`**: with the virtual already declared, it throws at the
  first invalid document. Read with `.collection.find()`, the driver's.
- **Migrating with `timestamps` on**: every migrated document gets a new `updatedAt`. Pass
  `timestamps: false`.
