---
title: Soft delete
description: Mark documents as deleted instead of removing them, and hide them from reads and updates, with the softDelete plugin.
---

`softDelete` marks a document as deleted with a `deletedAt` date, instead of removing it, and hides
the deleted documents from reads and updates. It is the official plugin of mongozod, in
`mongozod/plugins/soft-delete`.

```ts
import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import { softDelete } from 'mongozod/plugins/soft-delete'
import * as z from 'zod'

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

  deletedAt: mz.date()
    .optional()
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  plugins: [softDelete()]
})

const { insertedId: postId } = await PostsModel.insertOne({
  title: 'Hello, MongoDB',
  body: 'A first post.',
  authorId: new ObjectId()
})

await PostsModel.deleteOne({ _id: postId })
// { acknowledged: true, deletedCount: 1 }: the post has a `deletedAt` now

await PostsModel.findOne({ _id: postId })
// null: the reads skip the deleted posts

await PostsModel.find({ deletedAt: { $exists: true } })
// the trash: the filter mentions `deletedAt`, so the plugin leaves it alone
```

## The field

The schema declares `deletedAt`, optional and taking a `Date`: `mz.date().optional()`, or
`z.date().optional()`. With [several types of document](../guides/document-types.md), every type
declares it. A schema without it does not compile, and `mongozod()` throws an `Error`:
`softDelete needs the field "deletedAt" in the schema`. One with another type does not compile:
`softDelete needs "deletedAt" with a compatible type`.

## The rule

**If the filter mentions `deletedAt`, the plugin leaves it alone.** It looks for it at the top level
of the filter and inside `$and`, `$or` and `$nor`. That is why the plugin has no options and no
methods: a MongoDB filter says whether a call wants the live documents, the deleted ones or all of
them.

## What it does

- **Reads and updates**: when the filter does not mention `deletedAt`, the plugin adds
  `deletedAt: { $exists: false }`, in an `$and` with your filter, which it does not change. This
  covers `find`, `findOne`, `countDocuments`, `distinct`, `updateOne`, `updateMany`, `replaceOne`,
  `findOneAndUpdate` and `findOneAndReplace`.
- **Deletes**: `deleteOne` and `deleteMany` become an `updateOne` or an `updateMany` that sets
  `deletedAt` to the current date. The plugin dispatches it through the model, so
  [`timestamps`](../guides/timestamps.md) writes `updatedAt` and the other plugins see an update,
  with the options of the delete, `context` included. They return a `DeleteResult` whose
  `deletedCount` counts the documents marked. A document already deleted is not marked again:
  deleting it twice gives `deletedCount: 0` the second time.
- **`findOneAndDelete`** marks the document with a `findOneAndUpdate` and returns it as it was
  before, as the driver returns the document it deletes.
- **A delete whose filter mentions `deletedAt` removes the documents** for real. That is how you
  empty the trash.
- **`bulkWrite`**: each operation follows the same rule. The marked documents count in
  `matchedCount` and `modifiedCount`, as the driver reports updates, and `deletedCount` counts only
  the documents removed for real.
- **`populate`** reads through the model of the target, so a deleted document it points to is
  `null`, or left out of an array. See [Populate](../guides/populate.md).
- **`aggregate` and `estimatedDocumentCount`** are left alone, so they see the deleted documents
  too. A pipeline filters them in its first `$match`.

## Quick reference

| Task                            | Call                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| Read the live documents         | `find({ authorId })`                                                                   |
| Read the trash                  | `find({ authorId, deletedAt: { $exists: true } })`                                     |
| Read every document             | `find({ $or: [{ deletedAt: { $exists: true } }, { deletedAt: { $exists: false } }] })` |
| Delete                          | `deleteOne({ _id })`, which sets `deletedAt`                                           |
| Restore                         | `updateOne({ _id, deletedAt: { $exists: true } }, { $unset: { deletedAt: '' } })`      |
| Delete a live document for real | `deleteOne({ _id, deletedAt: { $exists: false } })`                                    |
| Empty the trash                 | `deleteMany({ deletedAt: { $lt: cutoff } })`                                           |
| Aggregate the live documents    | `aggregate([{ $match: { deletedAt: { $exists: false } } }, …])`                        |

## Read the deleted documents too

A filter that matches both, and mentions `deletedAt`, reads every document. Keep it in a constant,
and put it in an `$and` with the rest of the filter, so that it does not clash with an `$or` of its
own:

```ts
/** Matches every document, deleted or not: it mentions `deletedAt`, so softDelete stays out. */
const withDeleted = {
  $or: [{ deletedAt: { $exists: true } }, { deletedAt: { $exists: false } }]
}

const everyDraft = await PostsModel.find({ $and: [withDeleted, { status: 'draft' }] })
const total = await PostsModel.countDocuments(withDeleted)
```

To restore a document, mention `deletedAt` in the filter too:

```ts
await PostsModel.updateOne(
  { _id: postId, deletedAt: { $exists: true } },
  { $unset: { deletedAt: '' } }
)
```

## Upserts

The condition is `deletedAt: { $exists: false }` and not `deletedAt: null` because MongoDB copies
the equalities of the filter of an upsert into the document it inserts: a `null` would end up in the
new document, which the schema does not accept.

An upsert on the `_id` of a deleted document does not find it, so it tries to insert it and the
driver throws its duplicate key error, instead of restoring it without telling you. Restore it
first.

## Unique indexes

A unique index also counts the deleted documents, so a deleted post would keep its slug. A
[partial index](https://www.mongodb.com/docs/manual/core/index-partial/) on the live documents frees
it:

```ts separate
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import { softDelete } from 'mongozod/plugins/soft-delete'
import * as z from 'zod'

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: z.object({

    slug: z.string(),

    title: z.string(),

    deletedAt: mz.date()
      .optional()
  }),

  plugins: [softDelete()],

  indexes: (index) => [
    index({ slug: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } })
  ]
})

await PostsModel.sync()
```

`deletedAt: null` matches the documents without the field. The plugin does not touch the indexes:
[`sync()`](../guides/sync.md#indexes) creates the ones the model declares.

## With other plugins

A plugin that asks for a context in the updates has to ask for it in the deletes too, since the
update that marks a delete takes the options of the delete: see [Plugins](../guides/plugins.md#context).

## Reference

`softDelete()` takes no arguments.

| Part    | Value                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------ |
| Fields  | `deletedAt`: a `Date`, optional                                                                              |
| Options | None                                                                                                         |
| Context | None                                                                                                         |
| Methods | None                                                                                                         |
| Hooks   | `before` of the `read` and `update` groups, of `deleteOne`, `deleteMany`, `findOneAndDelete` and `bulkWrite` |

## Common mistakes

- **Restoring with a filter that does not mention `deletedAt`**, such as
  `updateOne({ _id }, { $unset: { deletedAt: '' } })`: the plugin skips the deleted documents, so
  it matches nothing and says nothing, with `matchedCount: 0`. Add `deletedAt: { $exists: true }`
  to the filter.
- **Counting with `aggregate` or `estimatedDocumentCount`**: both count the deleted documents. Add
  `{ $match: { deletedAt: { $exists: false } } }` to the pipeline, or use `countDocuments`.
- **Joining with `$lookup`**: it reads the other collection directly, deleted documents included.
  Filter them in the pipeline of the `$lookup`.
- **Letting clients filter by `deletedAt`**: a filter that mentions it turns the plugin off for that
  call, so a client could read the trash, or turn a delete into a real one. Leave `deletedAt` out of
  the allow list of [`mz.filter`](../guides/endpoint-inputs.md#mzfilter) unless the endpoint is for
  the trash.
- **A unique index without `partialFilterExpression: { deletedAt: null }`**: a deleted document
  keeps its key, and creating a new one with the same key fails.
- **Upserting the `_id` of a deleted document**: the driver throws a duplicate key error. Restore it
  with an update whose filter mentions `deletedAt`.
