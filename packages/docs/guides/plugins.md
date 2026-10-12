---
title: Plugins
description: Add plugins to a model, pass the options and the context they take, and call the methods they add.
---

A plugin hooks into the operations of a model: it can change their arguments and their results,
wrap them, add options, ask each call for a context and add methods to the model. mongozod ships
[`softDelete`](../plugins/soft-delete.md), and [Writing plugins](../plugins/writing-plugins.md)
shows how to write your own.

```ts
import { ObjectId } from 'mongodb'
import { definePlugin, mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import { softDelete } from 'mongozod/plugins/soft-delete'
import { z } from 'zod'

const postSchema = z.object({
  _id: mz.objectId().default(() => new ObjectId()),
  title: z.string(),
  body: z.string(),
  status: z.enum(['draft', 'published']).default('draft'),
  tags: z.array(z.string()).default([]),
  authorId: mz.objectId(),
  // The field that softDelete writes.
  deletedAt: mz.date().optional()
})

const PostsModel = mongozod({
  collection: 'posts',
  db,
  schema: postSchema,
  plugins: [logger(), softDelete(), audit(), exists()]
})

const actor = new ObjectId() // the `_id` of the user who makes the change

// audit asks each write for its context.
const { insertedId: postId } = await PostsModel.insertOne(
  { title: 'Hello, MongoDB', body: 'A first post.', authorId: actor },
  { context: { actor } }
)

// logger adds the `log` option to the reads, and exists adds a method.
const drafts = await PostsModel.find({ status: 'draft' }, { log: false })
const found = await PostsModel.exists({ title: 'Hello, MongoDB' })

// softDelete sets `deletedAt` instead of removing the post.
await PostsModel.deleteOne({ _id: postId }, { context: { actor } })
```

`softDelete` comes from `mongozod/plugins/soft-delete`. `logger`, `audit` and `exists` are plugins
of a project, written [at the end of this page](#the-plugins-of-this-page).

## Add plugins

The `plugins` option takes a list, applied in layers in its order: the first plugin wraps the rest,
so its `before` hooks run first and its `after` hooks run last. A plugin that measures each
operation goes first, to measure everything, and one that records what reaches the driver goes last.

A plugin declares the fields it works with, and the schema declares them, with a compatible type,
in [every type of document](./document-types.md). The schema stays the single source of truth, and
each project picks the type of each field. A schema without one of them does not compile, and
`mongozod()` throws an `Error`:

```text
softDelete needs the field "deletedAt" in the schema
```

A plugin that fills a field on every insert and replacement, such as the tenant of a multi-tenant
plugin, says so in its `fills`, and those writes take the field as optional, as they take the
fields of [`timestamps`](./timestamps.md).

## Options

A plugin can add options to the operations of a group. The `logger` of this page adds `log` to the
reads, so `find(filter, { log: false })` compiles and `deleteMany(filter, { log: false })` does not.
mongozod validates each option with the schema of its plugin, with its defaults, and throws a
`ZodError` when one does not fit. It removes them before calling the driver.

A plugin option cannot be named like an option of the driver, of mongozod (`context`, `populate`,
`schema`, `timestamps`) or of another plugin of the model: it does not compile, and `mongozod()`
throws an `Error` for the names of mongozod, `updatePipeline` included, and of other plugins.

## Context

Some plugins need to know something about each call, such as who makes a change or which tenant
reads. Each plugin declares that context for the groups of operations it needs it in:

| Group    | Operations                                                                       |
| -------- | -------------------------------------------------------------------------------- |
| `read`   | `find`, `findOne`, `countDocuments`, `distinct`                                  |
| `insert` | `insertOne`, `insertMany`                                                        |
| `update` | `updateOne`, `updateMany`, `replaceOne`, `findOneAndUpdate`, `findOneAndReplace` |
| `delete` | `deleteOne`, `deleteMany`, `findOneAndDelete`                                    |
| `bulk`   | `bulkWrite`                                                                      |

In the operations of those groups, the options become required, with a `context`. In the other
groups they take no context:

```ts
await PostsModel.updateOne(
  { _id: postId },
  { $set: { status: 'published' } },
  { context: { actor } }
)

// @ts-expect-error: the writes of this model need the context of audit
await PostsModel.updateOne({ _id: postId }, { $set: { status: 'draft' } })

// The reads need no context: no plugin asks for one there.
await PostsModel.countDocuments({ status: 'published' })
```

- **One `context` for every plugin**: the call passes one object with what each plugin asks for,
  and each plugin receives its part, validated with its schema. A context that does not fit throws
  a `ZodError` with its issues under `['context', …]`.
- **Plugin methods** that pass their options on to an operation, as `exists` does, take the
  context of that operation.
- **`populate`** passes the context of the read on to the models it reads, whose plugins validate
  their part. A read that populates a model whose plugins ask for a context in the reads takes one,
  also through a nested `populate`.
- **`softDelete` turns a delete into an update**, which receives the options of the delete,
  `context` included. A plugin that asks for a context in the updates has to ask for it in the
  deletes too, as `audit` does: otherwise a delete compiles without it, and the update it becomes
  throws a `ZodError`.

In an app with services, the context travels in the options that the service already passes to the
model. `ReadOptionsArg` types those options for the reads of a model, `context` included:

```ts
import type { ReadOptionsArg } from 'mongozod'

/** Counts the published posts, with the options of the call. */
function countPublished(...options: ReadOptionsArg<typeof PostsModel>) {
  return PostsModel.countDocuments({ status: 'published' }, ...options)
}
```

> [!WARNING]
> `aggregate` and `estimatedDocumentCount` belong to no group and take no context: only their own
> hooks and a plugin's middleware run on them. A plugin that isolates a tenant or hides deleted
> documents does not apply to a pipeline, so the pipeline filters them in its `$match`, and a
> `$lookup` or a `$group` sees every document. See [Aggregation](./aggregation.md#plugins).

## Methods

A plugin can add methods to the model, typed by it: the filter of `exists` is checked against the
posts, like the filter of `find`:

```ts
// @ts-expect-error: the title of a post is a string
await PostsModel.exists({ title: 1 })
```

Two plugins that add a method with the same name, or a method named like a member of the model,
such as `find`, do not compile, and `mongozod()` throws an `Error`: `two plugins define "exists"`.

## What plugins don't see

- **`model.collection`** is the driver's collection, for what the model does not wrap: writes
  through it skip the validation and the plugins.
- **Change streams**: `model.collection.watch()` reports the changes once they are stored, so no
  plugin runs on them.
- **`aggregate` and `estimatedDocumentCount`**, as the warning above says.

## The plugins of this page

These are short versions of a project's plugins: `audit` declares its context and leaves out the
hooks that would store the actor. [Writing plugins](../plugins/writing-plugins.md) explains each
part.

```ts
import type { AnyModel, FilterOf } from 'mongozod'

/** Logs each operation with its duration. A read can turn it off with `log: false`. */
function logger() {
  return definePlugin({
    id: 'logger',
    options: { read: z.object({ log: z.boolean().default(true) }) },
    async middleware({ args, model, next, operation }) {
      const started = performance.now()
      const result = await next()

      if (args.options.log !== false) {
        console.info(`${model.name}.${operation}: ${Math.round(performance.now() - started)} ms`)
      }

      return result
    }
  })
}

const actorContext = z.object({ actor: mz.objectId() })

/** Asks each write for the user who makes it. */
function audit() {
  return definePlugin({
    id: 'audit',
    context: { insert: actorContext, update: actorContext, delete: actorContext }
  })
}

/** Adds `exists`, which says whether a document matches a filter. */
function exists() {
  return definePlugin({
    id: 'exists',
    methods: {
      async exists<M extends AnyModel, const F extends FilterOf<M, F>>(
        this: M,
        filter: F,
        ...options: ReadOptionsArg<M>
      ) {
        return (await this.countDocuments(filter, { ...options[0], limit: 1 })) > 0
      }
    }
  })
}
```

## Common mistakes

- **Leaving the fields of a plugin out of the schema**: it does not compile, and `mongozod()`
  throws an `Error` that names the field. Declare it, with the type the plugin needs.
- **Writing through `model.collection`**: the plugins don't run, so `softDelete` does not hide or
  mark anything there. Use the operations of the model.
- **Expecting a plugin to filter `aggregate`**: no group hook runs on it. Add the condition to the
  first `$match` of the pipeline, such as `{ deletedAt: { $exists: false } }`.
- **Putting the plugins in any order**: they run in layers, so the first one sees the operation as
  the caller wrote it and the last one sees it as the others left it.
- **Asking for a context in the updates but not in the deletes**, next to `softDelete`: a delete
  compiles without the context and throws a `ZodError`. Ask for it in both groups.
