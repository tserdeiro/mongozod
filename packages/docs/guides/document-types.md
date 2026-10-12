---
title: Document types
description: Store several types of document in one collection with a z.discriminatedUnion, with subtypes up to three levels.
---

One collection can store several types of document, what Mongoose calls discriminators. The schema
is a `z.discriminatedUnion` of objects: its key, such as `kind`, is a field of the document that
says its type, and the filter of each operation decides which types it reads or writes.

```ts
import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import { z } from 'zod'

const basePost = z.object({
  _id: mz.objectId().default(() => new ObjectId()),
  title: z.string(),
  status: z.enum(['draft', 'published']).default('draft'),
  tags: z.array(z.string()).default([]),
  authorId: mz.objectId()
})

const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('image'), src: z.url(), alt: z.string().optional() })
])

const video = basePost.extend({ kind: z.literal('video'), seconds: z.number().int() })

const postSchema = z.discriminatedUnion('kind', [
  basePost.extend({ kind: z.literal('article'), blocks: z.array(blockSchema).default([]) }),
  basePost.extend({ kind: z.literal('link'), url: z.url() }),
  // A type with subtypes: a union of its own, with its own key.
  z.discriminatedUnion('source', [
    video.extend({ source: z.literal('youtube'), youtubeId: z.string() }),
    video.extend({ source: z.literal('upload'), fileId: mz.objectId() })
  ])
])

const PostsModel = mongozod({ collection: 'posts', db, schema: postSchema })

const authorId = new ObjectId() // the `_id` of a user

const { document: link } = await PostsModel.insertOne({
  kind: 'link',
  title: 'The MongoDB manual',
  url: 'https://www.mongodb.com/docs/manual/',
  authorId
})

const links = await PostsModel.find({ kind: 'link' })
// links: Array<{ _id: ObjectId; kind: 'link'; url: string; title: string; … }>

await PostsModel.updateOne(
  { _id: link._id, kind: 'link' },
  { $set: { url: 'https://www.mongodb.com/docs/' } }
)
```

## The schema

- **The root** is a `z.discriminatedUnion` of `z.object`s, whose options can be other
  `z.discriminatedUnion`s, for [subtypes](#subtypes).
- **The key** is the one you pass to `z.discriminatedUnion`, like Mongoose's `discriminatorKey`. It
  is a field of the schema like any other: mongozod adds no field of its own, unlike the `__t` that
  Mongoose adds ([Mongoose docs](https://mongoosejs.com/docs/discriminators.html)).
- **Shared fields** go in a base object that each type extends with `.extend()`, as Zod recommends
  ([Zod docs](https://zod.dev/api#intersections)). An intersection, with `z.intersection()` or
  `.and()`, does not compile, and `mongozod()` throws an `Error`: it has no `pick` or `omit`, and
  `.extend()` gives a `z.object`.

An insert validates the document against the type its key chooses: a document that does not fit
it, such as a link without its `url`, does not compile and throws a `ZodError`.

## Reads

`find`, `findOne` and the cursor's `.project()` return the types of document the filter allows.
The filter fixes the type with an equality, `$eq` or `$in` on the key, at its top level or inside
`$and`:

```ts
const videos = await PostsModel.find({ kind: 'video' })
// the YouTube videos and the uploaded ones

const youtube = await PostsModel.find({ kind: 'video', source: 'youtube' })
// only the YouTube videos: youtube[0]?.youtubeId is a string

const notes = await PostsModel.find({ kind: { $in: ['article', 'link'] } })
// the articles and the links
```

`$or` and `$ne` don't fix the type, so their reads return the whole union, and so do the
`findOneAnd*` operations. To type a service with the documents of a read, `ReadOf` takes the same
filter:

```ts
import type { ReadOf } from 'mongozod'

type LinkPost = ReadOf<typeof PostsModel, { filter: { kind: 'link' } }>
```

The projection is typed type by type, and each path of a filter, a sort or a projection is looked
up in every type.

## Updates

Each field an update writes has to be in every type the filter allows. A field that every type has,
such as `title` or `tags`, needs no filter on the key; one that only some types have needs the
filter to fix them:

```ts
await PostsModel.updateMany({ authorId }, { $addToSet: { tags: 'mongodb' } })

// @ts-expect-error: "url" is not in every type allowed: fix "kind" in the filter
await PostsModel.updateOne({ _id: link._id }, { $set: { url: 'https://www.mongodb.com/' } })
```

The update without the filter on `kind` does not compile, and it throws a `ZodError`:
`"url" is not in every type allowed: fix "kind" in the filter`. A value also has to fit every type
the filter allows. A type whose key is a `z.enum`, such as `z.enum(['note', 'aside'])`, is allowed
when the filter fixes one of its values.

## Change the type of a document

An update cannot change the key, because the document would be left without the fields of its new
type: it does not compile and throws a `ZodError`,
`"kind" is the discriminator of its object: replace the object to change it`. Replace the document
with `replaceOne`, which validates it as a whole:

```ts
await PostsModel.replaceOne(
  { _id: link._id },
  {
    kind: 'article',
    title: link.title,
    authorId: link.authorId,
    blocks: [{ type: 'text', text: 'Read the MongoDB manual.' }]
  }
)
```

In an upsert, `$setOnInsert` can set the key, which chooses the type of the new document. With a
`z.enum` key, an update cannot change it between two values of the same type either.

Mongoose drops an update of the key without telling you, unless you pass
`overwriteDiscriminatorKey` ([Mongoose docs](https://mongoosejs.com/docs/discriminators.html)).

## Subtypes

An option of the union can be another `z.discriminatedUnion`, with its own key, like the videos
above. Each level follows the same rules with its key: the filter fixes `kind` to write the fields
of every video, and `kind` and `source` to write the fields of one source:

```ts
await PostsModel.updateMany({ kind: 'video' }, { $set: { seconds: 60 } })
await PostsModel.updateMany({ kind: 'video', source: 'youtube' }, { $set: { youtubeId: 'abc' } })
```

The unions nest up to three levels: a deeper schema does not compile, because a recursive type is
too deep for TypeScript. Mongoose has no discriminators of several levels: it is its most upvoted
open issue, [Automattic/mongoose#2851](https://github.com/Automattic/mongoose/issues/2851).

## Unions inside a field

A `z.discriminatedUnion` inside a field, such as the `blocks` of an article, follows the same rule.
The key of each union on the path is fixed by the condition that chooses its document or its
element: the filter or, when the path goes through a `$[id]`, its entry in `arrayFilters`:

```ts
await PostsModel.updateMany(
  { kind: 'article' },
  { $set: { 'blocks.$[image].alt': 'An image of the post' } },
  { arrayFilters: [{ 'image.type': 'image' }] }
)
```

`$`, `$[]` and an array index cannot fix the key of an element, so through them an update writes
only the fields that every type of element has. To change the key of a nested union, replace the
whole object.

## With the rest of the model

- **[`timestamps`](./timestamps.md)** and the fields that [plugins](./plugins.md) need, such as the
  `deletedAt` of `softDelete`, go in every type: in the base object, for instance.
- **[Virtuals](./virtuals.md)** read fields that every type has, so each virtual has one type.
- **[References](./populate.md)** can be fields of one type only, and the `filter` of a `populate`
  narrows the types of the documents it brings, like the filter of a read.

## Common mistakes

- **Writing a field of one type without fixing the key in the filter**: it does not compile and
  throws a `ZodError` that says which key to fix. Add it to the filter, as `{ _id, kind: 'link' }`.
- **Fixing the key with `$or` or `$ne`**: they don't narrow the type, so neither the read nor the
  update knows which type it gets. Use an equality, `$eq` or `$in`.
- **Changing the type with `$set`**: it does not compile and throws a `ZodError`. Replace the
  document with `replaceOne`.
- **Combining objects with `z.intersection()` or `.and()`**: it does not compile, and `mongozod()`
  throws an `Error`. Use `.extend()`.
- **A `z.union()` at the root**: the model takes a `z.discriminatedUnion` only, whose key tells the
  types apart. It does not compile and throws an `Error`.
- **Declaring the fields of `timestamps` or of a plugin in some types only**: it does not compile,
  and `mongozod()` throws an `Error`. Declare them in the base object.
