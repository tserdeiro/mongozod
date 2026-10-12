---
title: Transforms
description: Hash a password before it is stored, compute a field from others, and check the database inside a transaction.
---

The schema can change what a write stores: a `.transform()` on a field changes its value after
validating it, and `.overwrite()` on the document computes one field from others. This page also
shows where a check against the database goes when it has to see a transaction.

## Hash a password, like `pre('save')`

Where Mongoose code hashes a password in a `pre('save')`
[middleware](https://mongoosejs.com/docs/middleware.html#pre), mongozod uses a `.transform()` of
the field, which can be async:

```ts
import { randomBytes, scrypt } from 'node:crypto'

import { ObjectId } from 'mongodb'
import { definePlugin, mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

function hashPassword(password: string): Promise<string> {

  const salt = randomBytes(16).toString('hex')

  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, key) => {
      if (error) reject(error)
      else resolve(`${salt}:${key.toString('hex')}`)
    })
  })
}

const userSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  email: z.email(),

  password: z.string()
    .min(8)
    .transform(hashPassword)
})

const UsersModel = mongozod({

  collection: 'users',

  db,

  schema: userSchema
})

const { document: user } = await UsersModel.insertOne({
  email: 'ana@example.com',
  password: 'correct horse'
})
// { _id: ObjectId('…'), email: 'ana@example.com', password: '9f2c…:4b1e…' }
```

Zod validates the field first and transforms it after, so `.min(8)` checks what the user typed and
the hash is what gets stored. A short password throws a `ZodError` at `password`, and nothing is
hashed.

The transform runs on every write that sets the field: inserts, replacements and updates, as in
`$set: { password }`. Mongoose's `save()` hooks don't run on `findOneAndUpdate()` and other updates
([Mongoose docs](https://mongoosejs.com/docs/middleware.html#notes)).

A plugin's `before` hook is not the place for it: it sees the call as written, before the schema
validates it, so the schema would validate the hash.

## Don't transform twice

A transform runs on whatever you write, also on a value that it already transformed. Writing back
a document you read hashes the hash:

```ts
const stored = await UsersModel.findOne({ _id: user._id })

if (stored) {
  // Wrong: `stored.password` is the hash, and the transform hashes it again.
  await UsersModel.replaceOne({ _id: stored._id }, stored)
}

// Right: write only what changes.
await UsersModel.updateOne({ _id: user._id }, { $set: { email: 'ana@example.org' } })
```

Transforms that give the same result when they run twice, such as `.trim()` or `.toLowerCase()`,
are safe to write back. For one that doesn't, such as a hash:

- **Write what changes**: update the other fields with `$set`, and the password only when the user
  sends a new one. mongozod has no `.save()`, so this is the usual way.
- **Or hash in the service**: store a `passwordHash: z.string()`, hash before calling the model, and
  validate the password the user typed in the endpoint's input.

## A field computed from others

A slug computed from the title goes in `.overwrite()`, not in a `.transform()` of the whole
document. See [Schemas](../guides/schemas.md#fields-computed-from-others) for why, and why the
schema declares `slug` with a default.

```ts
function slugify(title: string) {
  return title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
}

const postSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  title: z.string()
    .min(1),

  slug: z.string()
    .default('')
})
  .overwrite((post) => ({ ...post, slug: slugify(post.title) }))

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema
})

const { document: post } = await PostsModel.insertOne({ title: 'Hello, MongoDB' })
// { _id: ObjectId('…'), title: 'Hello, MongoDB', slug: 'hello-mongodb' }
```

`.overwrite()` runs on inserts and replacements, not on updates, so `$set: { title }` leaves the
slug as it was. Set both:

```ts
const title = 'Hello again, MongoDB'

await PostsModel.updateOne({ _id: post._id }, { $set: { title, slug: slugify(title) } })
```

## Check the database inside a transaction

An async refinement can query the database, but it runs without the session of the operation: in a
transaction, it reads outside of it and doesn't see the transaction's own writes. A check that has
to see them goes in a plugin's `before` hook, whose `args.options` has the `session` of the call:

```ts
const commentSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  postId: mz.objectId(),

  body: z.string()
    .min(1)
})

/** Rejects a comment whose post doesn't exist, inside the transaction of the insert. */
function postExists() {
  return definePlugin({

    id: 'postExists',

    fields: {

      postId: mz.objectId()
    },

    hooks: {

      insertOne: {

        async before({ args }) {

          // The hook sees the call before validation: the id may still be a hex string.
          const postId = mz.objectId().parse(args.document.postId)

          const count = await PostsModel.countDocuments(
            { _id: postId },
            { limit: 1, session: args.options.session }
          )

          if (count === 0) throw new Error(`post ${postId.toHexString()} does not exist`)
        }
      }
    }
  })
}

const CommentsModel = mongozod({

  collection: 'comments',

  db,

  schema: commentSchema,

  plugins: [postExists()]
})

await client.withSession((session) =>
  session.withTransaction(async () => {

    const { document: draft } = await PostsModel.insertOne({ title: 'Draft' }, { session })

    // The hook reads with the session, so it sees the post this transaction inserted.
    await CommentsModel.insertOne({ postId: draft._id, body: 'First!' }, { session })
  })
)
```

With `postId: mz.objectId().refine(async (id) => …)`, the same check would read outside of the
transaction, not find the post and throw a `ZodError`. A complete plugin also covers `insertMany`,
the replacements and the updates that set `postId`. See
[Writing plugins](../plugins/writing-plugins.md) and [Transactions](../guides/transactions.md).

## Common mistakes

- **Hashing in a plugin's `before` hook**: the schema validates the hash, not the password. Hash in
  a `.transform()` of the field or in the service.
- **Writing back a document you read**: a transform that isn't idempotent, such as a hash, runs
  again. Update only what changes with `$set`.
- **Updating the source of a computed field alone**: `$set: { title }` doesn't run `.overwrite()`.
  Set the computed field in the same update, or read the document and `replaceOne` it.
- **A database check in `.refine(async)` inside a transaction**: it doesn't see the transaction's
  writes. Move it to a plugin's `before` hook and pass `args.options.session`.
