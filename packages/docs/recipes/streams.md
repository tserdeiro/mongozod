---
title: Streams
description: Read many documents batch by batch with for await and Node.js streams, and follow changes with change streams.
---

`await` on a cursor reads every document into an array. To go through many documents without
holding them all, iterate the cursor with `for await`: it reads them batch by batch, as the server
returns them.

```ts
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import { z } from 'zod'

const postSchema = z.object({
  _id: mz.objectId().default(() => new ObjectId()),
  title: z.string().min(1),
  body: z.string().default(''),
  status: z.enum(['draft', 'published']).default('draft')
})

const PostsModel = mongozod({ collection: 'posts', db, schema: postSchema })

let words = 0

for await (const post of PostsModel.find({ status: 'published' }, { projection: { body: 1 } })) {
  words += post.body.split(/\s+/).length
}
```

## Iterate with `for await`

Each batch gets its virtuals and its `populate` at once, with one query per reference. The
driver's `batchSize` option, in the options of `find`, sets how many documents a batch has. A loop
that ends early, with `break`, `return` or an error, closes the cursor on the server.

The cursor has no `.map()`, `.next()`, `.hasNext()` or `.forEach()`. `for await` covers them, and an
async generator maps the documents:

```ts
async function* titles() {
  for await (const post of PostsModel.find({}, { projection: { title: 1 } })) {
    yield post.title.toUpperCase()
  }
}

for await (const title of titles()) console.log(title)
```

## Pipe into a Node.js stream

`Readable.from()` turns the cursor, or a generator over it, into a Node.js stream, for the APIs that
take a `Readable`. This writes the published posts to a file of
[NDJSON](https://github.com/ndjson/ndjson-spec), one per line, with `pipeline`:

```ts
async function* ndjson(posts: AsyncIterable<unknown>) {
  for await (const post of posts) yield `${JSON.stringify(post)}\n`
}

await pipeline(
  Readable.from(ndjson(PostsModel.find({ status: 'published' }))),
  createWriteStream('posts.ndjson')
)
```

## Follow changes with change streams

A model has no `watch`: open a change stream on the driver's collection, `PostsModel.collection`,
which is typed with the schema:

```ts
const changes = PostsModel.collection.watch([{ $match: { operationType: 'insert' } }])

for await (const change of changes) {
  if (change.operationType === 'insert') console.log('new post', change.fullDocument.title)
}
```

It is the driver's
[`watch()`](https://www.mongodb.com/docs/drivers/node/current/monitoring-and-logging/change-streams/),
with its options, such as `fullDocument: 'updateLookup'` for the document after each update, and
`changes.close()` to stop. Change streams need a replica set or a sharded cluster
([MongoDB manual](https://www.mongodb.com/docs/manual/changeStreams/)).

A change stream reports a write once it is stored, so it can't validate, change or cancel it, and
its events don't go through the plugins of the model or the schema. A soft delete of
[`softDelete`](../plugins/soft-delete.md) arrives as an update. With
[`db` as a function](./multi-tenant.md), `PostsModel.collection` is the collection of the database
the function returns when you call it.

## Common mistakes

- **`await` on a large cursor**: it loads every document into memory. Use `for await`, or
  `Readable.from()` for a stream.
- **Looking for `cursor.map()` or `cursor.forEach()`**: they don't exist. Use `for await` and an
  async generator.
- **Expecting a change stream to validate**: it reports writes after they are stored, without the
  schema or the plugins. Validate in the writes, and react in the stream.
