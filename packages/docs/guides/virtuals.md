---
title: Virtuals
description: Compute fields from the stored ones when you read, without storing them.
---

A virtual is a field that reads compute from other fields of the document, and that the database
does not store. Each one is a Zod schema in the `virtuals` option of `mongozod()`: a `pick` of the
fields it reads, and a `transform` that computes its value.

```ts
import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import { z } from 'zod'

const postSchema = z.object({
  _id: mz.objectId().default(() => new ObjectId()),
  title: z.string(),
  body: z.string(),
  status: z.enum(['draft', 'published']).default('draft'),
  tags: z.array(z.string()).default([]),
  authorId: mz.objectId()
})

const PostsModel = mongozod({
  collection: 'posts',
  db,
  schema: postSchema,
  virtuals: {
    readingMinutes: postSchema
      .pick({ body: true })
      .transform(({ body }) => Math.max(1, Math.round(body.split(/\s+/).length / 200))),
    path: postSchema.pick({ _id: true }).transform(({ _id }) => `/posts/${_id.toHexString()}`)
  }
})

const posts = await PostsModel.find(
  { status: 'published' },
  { projection: { title: 1, readingMinutes: 1 } }
)
// [{ _id: ObjectId('…'), title: 'Hello, MongoDB', readingMinutes: 4 }]
```

The projection asks for `readingMinutes`, so mongozod asks the server for the `body` it reads,
computes it and returns only what the projection asked for.

## Declare a virtual

The `pick` declares the fields the virtual reads, and the `transform` receives those fields only,
typed by the schema. A virtual is a plain Zod schema, without a helper from mongozod, so it can live
next to the schema of the document and run in a client too.

With [Zod Mini](https://zod.dev/packages/mini), the same virtual is a `z.pipe` of a `z.pick` and a
`z.transform`. mongozod reads the fields from the object at the start of the pipes:

```ts separate
import { mongozod } from 'mongozod'
import { z } from 'zod/mini'

const postSchema = z.object({ title: z.string(), body: z.string() })

const PostsModel = mongozod({
  collection: 'posts',
  db,
  schema: postSchema,
  virtuals: {
    readingMinutes: z.pipe(
      z.pick(postSchema, { body: true }),
      z.transform(({ body }) => Math.max(1, Math.round(body.split(/\s+/).length / 200)))
    )
  }
})
```

`mongozod()` checks each virtual against the schema:

- **Its name** is not a field of the schema: one that is does not compile, and `mongozod()`
  throws an `Error`. A name with a `.` or that starts with `$` throws too.
- **The fields it reads** are fields of the document, with the types the schema stores: a field the
  document does not have does not compile and throws an `Error`, and one with another type does not
  compile.
- **It takes an object**, the one its `pick` gives: a virtual that does not, such as
  `z.string().transform(…)`, does not compile and throws an `Error` that says to pick the fields it
  reads.
- **With [several types of document](./document-types.md)**, the fields it reads are in every type,
  so the virtual exists in every one and has one type.

The model exposes them in `PostsModel.virtuals`.

## Where they are computed

Virtuals are computed in the reads that return documents: `find`, `findOne`, `findOneAndUpdate`,
`findOneAndReplace` and `findOneAndDelete`. A cursor read with `for await` computes them batch by
batch. They are part of the type of each read:

```ts
const post = await PostsModel.findOne({ status: 'published' })
// post?.readingMinutes: number, post?.path: string
```

Writes return what was stored: the `document` of `insertOne` and the `documents` of `insertMany`
have no virtuals. `aggregate` does not compute them either: a pipeline computes the same value with
`$addFields`.

## Projections

- **An inclusion** returns the virtuals it asks for, with `1` or `true`, and no other. mongozod asks
  the server for the fields they read and removes the ones the projection did not ask for:
  `{ readingMinutes: 1 }` gives `{ _id, readingMinutes }`, and `{ _id: 0, path: 1 }`, whose virtual
  reads only the `_id`, gives `{ path }`.
- **An exclusion** keeps every virtual, except the ones it excludes, such as `{ path: 0 }`, and the
  ones whose fields it leaves out or changes: `{ body: 0 }` also leaves out `readingMinutes`.
- **A virtual takes `0`, `1`, `true` or `false`**: any other value throws a `ZodError`.
- **A virtual reads its fields as stored**, so a projection that asks for it and changes one of
  them, with a subfield, `$slice`, `$elemMatch` or a `$meta` such as the text score, does not
  compile and throws a `ZodError`.

```ts
const [card] = await PostsModel.find({}, { projection: { _id: 0, title: 1, path: 1 } })
// { title: 'Hello, MongoDB', path: '/posts/…' }: the `_id` is read for `path`, and removed.
```

## Through populate

`populate` reads the referenced documents through their model, so their virtuals apply and their
projection can ask for them: with a `fullName` virtual on the users,
`populate: { authorId: { projection: { fullName: 1 } } }` gives `authorId: { _id, fullName }`. See
[Populate](./populate.md).

A whitelist of [`mz.projection`](./endpoint-inputs.md#mzprojection) or `mz.populate` adds the
virtual as one more field, because the schemas of the inputs do not import models:
`postSchema.pick({ _id: true, title: true }).extend({ readingMinutes: z.number() })`. When the
router passes the input to the model, its types check that each key is a field or a virtual of the
model.

## Stored data that does not fit

A virtual validates the fields it reads with its `pick`. When a stored document does not pass it,
such as an old one written before the schema changed, the read throws a `ZodError` with the path of
the field. Leaving the virtual out instead would type every virtual as optional. Check the stored
documents before you add a virtual, then migrate them, or give the field a `.default()`, which the
`pick` applies to a document without the field: see
[Schema migrations](../recipes/schema-migrations.md#add-a-virtual).

## What a virtual is not

Like a [Mongoose virtual](https://mongoosejs.com/docs/tutorials/virtuals.html), a virtual is not
stored, so a filter or a sort on it does not compile, and neither does an update that writes it.
There are no setters. Unlike Mongoose, where a `lean()` read has no virtuals and `toJSON()` leaves
them out by default, a read returns plain objects with the virtuals in them.

## Common mistakes

- **Expecting a virtual in an inclusion that does not name it**: `{ title: 1 }` returns no
  virtual. Add it to the projection: `{ title: 1, readingMinutes: 1 }`.
- **Expecting the virtuals in the result of an insert**: the `document` of `insertOne` is what was
  stored. Read the document to get them.
- **Filtering or sorting by a virtual**: it does not compile, because the database does not have
  it. Filter by the fields it reads, or store the value in a field.
- **Picking a field whose transform changes its type**, such as a string the schema turns into a
  number: the `pick` parses the stored value again, with the input type, so it does not compile.
  Declare the virtual with a schema that takes the field as it is stored.
- **Expecting `aggregate` to compute them**: it does not. Compute the value with `$addFields` in the
  pipeline.
- **Reading old documents that do not fit the `pick`**, such as ones without a field the schema
  now requires: the read throws a `ZodError`. Migrate the documents, or give the field a
  `.default()`, before you deploy the virtual.
