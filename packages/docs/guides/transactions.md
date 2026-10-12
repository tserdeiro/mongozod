---
title: Transactions
description: Run several operations atomically with the driver's withSession and withTransaction, passing the session to each operation.
---

MongoZod has no transaction helper of its own: a transaction is the driver's. Start a session with
`client.withSession()`, run the operations in `session.withTransaction()`, and pass `{ session }`
to each operation of a model, as you would to a collection of the driver.

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

  commentCount: z.number()
    .int()
    .min(0)
    .default(0)
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema
})

const commentSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  postId: mz.objectId(),

  body: z.string()
    .min(1)
})

const CommentsModel = mongozod({

  collection: 'comments',

  db,

  schema: commentSchema
})

export async function addComment(postId: ObjectId, body: string) {
  return client.withSession((session) =>
    session.withTransaction(async () => {

      const { document } = await CommentsModel.insertOne({ postId, body }, { session })

      await PostsModel.updateOne({ _id: postId }, { $inc: { commentCount: 1 } }, { session })

      return document
    })
  )
}
```

`withTransaction` commits when the callback resolves, and returns what it returns. When the callback
throws, the transaction is aborted and the error is rethrown: a `ZodError` from the second write
undoes the first one. See the driver's
[transactions guide](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/).

Transactions need a replica set or a sharded cluster, as the
[MongoDB manual](https://www.mongodb.com/docs/manual/core/transactions/) says.

## Every operation takes the session

An operation without `{ session }` runs outside the transaction, without an error: it doesn't see
the transaction's writes, and its own writes stay even when the transaction aborts. The `session`
option goes next to the driver's other options and MongoZod's:

```ts
await client.withSession((session) =>
  session.withTransaction(async () => {

    const post = await PostsModel.findOne({ title: 'Hello, MongoDB' }, { session })

    if (!post) throw new Error('the post does not exist')

    await CommentsModel.deleteMany({ postId: post._id }, { session })
    await PostsModel.deleteOne({ _id: post._id }, { session })
  })
)
```

- **`find` and `aggregate`**: a cursor keeps the session it was created with, so pass it in the
  options of the call, `find(filter, { session })`, not later.
- **`populate`**: its reads share the session of the read that asks for them, so a populated
  document written earlier in the transaction is found.

## The client of a model

Code that has a model but not the client, such as a service, reaches it through the model's
database, the driver's `Db`, with `db.client`:

```ts
export async function renamePost(postId: ObjectId, title: string) {
  await PostsModel.db.client.withSession((session) =>
    session.withTransaction(async () => {
      await PostsModel.updateOne({ _id: postId }, { $set: { title } }, { session })
    })
  )
}
```

When the model's `db` is a function, `PostsModel.db` is the database it returns at that moment. See
[Models](./models.md).

## Validation and the session

The schema's async refinements run without the session: a refinement that queries the database
reads outside the transaction, so it doesn't see what the transaction wrote. A check that has to
see it goes in a `before` hook of a plugin, which gets the `session` in the options of the
operation. A plugin's `middleware` can also run the whole operation in a transaction, with
`next({ session })`. See [Writing plugins](../plugins/writing-plugins.md).

## Common mistakes

- **Leaving out `{ session }` in one operation**: it runs outside the transaction. A read doesn't
  see the transaction's writes, and a write is kept when the transaction aborts. Pass the session to
  every operation in the callback.
- **Catching an error inside the callback without rethrowing it**: the driver can't tell whether the
  transaction was aborted, and per the documentation of `withTransaction` it may retry it without
  end. Let errors reach `withTransaction`, or rethrow them.
- **Running operations in parallel with `Promise.all`**: the driver doesn't support parallel
  operations in one transaction. Await them one after the other.
- **Side effects in the callback, such as an email**: the driver may call the callback more than
  once to retry the transaction. Send it after `withTransaction` resolves.
- **Checking uniqueness or balances with an async refinement**: it reads outside the transaction.
  Use a plugin's `before` hook with the session, or a unique index.
- **Running transactions against a standalone server**: they need a replica set. In tests, run
  MongoDB as a single-node replica set.
