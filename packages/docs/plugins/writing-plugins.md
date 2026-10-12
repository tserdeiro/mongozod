---
title: Writing plugins
description: Write a plugin with definePlugin, with its fields, fills, options, context, hooks, middleware and methods.
---

A plugin is a function that returns `definePlugin({ … })`, so that it can take a configuration of
its own. `definePlugin` infers the type of each part, and the model takes them: the fields its
schema needs, the options and the context of its operations, and the methods it adds.

```ts
import { ObjectId } from 'mongodb'
import { definePlugin, mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

/** Logs each operation of the model with its duration. A read can turn it off with `log: false`. */
export function logger(write: (line: string) => void = console.info) {
  return definePlugin({

    id: 'logger',

    options: {

      read: z.object({

        log: z.boolean()
          .default(true)
      })
    },

    async middleware({ args, model, next, operation }) {

      const started = performance.now()
      const result = await next()

      if (args.options.log !== false) {
        write(`${model.name}.${operation}: ${Math.round(performance.now() - started)} ms`)
      }

      return result
    }
  })
}

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

  authorId: mz.objectId()
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  plugins: [logger()]
})

await PostsModel.countDocuments({ status: 'published' })
// posts.countDocuments: 2 ms

await PostsModel.countDocuments({ status: 'draft' }, { log: false })
// nothing
```

To use plugins in a model, see [Plugins](../guides/plugins.md).

## The parts of a plugin

| Part         | What it is                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------ |
| `id`         | The name of the plugin in error messages. Required.                                        |
| `fields`     | A Zod shape with the fields the plugin works with, which the schema of the model declares. |
| `fills`      | The fields of `fields` that its hooks fill on every insert and replacement.                |
| `options`    | A `z.object` per group of operations, with the options it adds to them.                    |
| `context`    | A `z.object` per group of operations, with what each call has to pass it.                  |
| `hooks`      | `before` and `after` hooks per operation or per group.                                     |
| `middleware` | A function that wraps the whole operation.                                                 |
| `methods`    | Methods added to the model.                                                                |

## Fields

`fields` is a Zod shape with the fields the plugin reads or writes. The schema of the model declares
them, in every type of document, with a type whose output fits the plugin's. Each project picks the
type, such as an `ObjectId` or a UUID for an `updatedBy`, and the schema still describes the whole
document. When the schema does not, the model does not compile, and TypeScript shows the message of
the plugin:

```text
audit needs the field "updatedBy" in the schema
audit needs "updatedBy" with a compatible type
```

`mongozod()` also throws an `Error` for a missing field when it defines the model.

## Fills

`fills` lists the fields of `fields` that the plugin's `before` hooks fill on every insert and
replacement, such as the `tenantId` of a multi-tenant plugin or the `updatedBy` of the example
below. Those writes take them as optional, as they take the fields of
[`timestamps`](../guides/timestamps.md): the caller does not pass them, and when it does, as an
import might, the plugin decides whether to keep them. A name that is not in `fields` does not
compile, and `mongozod()` throws an `Error`.

The schema still validates them after the hooks, so a write the plugin does not fill throws a
`ZodError`. The types cannot see which hooks fill them, so covering every write is the plugin's job:

- `insertOne` and `insertMany`, or the `insert` group;
- `replaceOne` and `findOneAndReplace`, in the `update` group;
- the `insertOne` and `replaceOne` operations of `bulkWrite`;
- an upsert that creates the document, which needs the field in its `$set`, its `$setOnInsert` or
  an equality of its filter.

## Options

`options` takes a `z.object` per group of operations. Its fields join the driver's options in the
operations of that group: with the `logger` above, `find(filter, { log: false })` compiles and
`deleteOne(filter, { log: false })` does not. mongozod validates them with their schema, with its
defaults and transforms, before the hooks run, and removes them before calling the driver: the
hooks see them parsed, in `args.options`.

An option cannot be named like one of the driver, of mongozod (`context`, `populate`, `schema`,
`timestamps` or `updatePipeline`, the option of [update pipelines](../guides/operations.md#update))
or of another plugin of the model: it does not compile, and `mongozod()` throws an `Error` for the
names of mongozod and of other plugins.

## Context

`context` takes a `z.object` per group of operations, with what the plugin needs to know of each
call, such as who makes a change. In the operations of those groups, the options of the call become
required, with a `context`. A method that passes its options on to one of them, typed with
`ReadOptionsArg` or `UpdateOptionsArg`, requires it too.

- **Each plugin receives its part**: the output of its own schema, in the `context` of its hooks
  and its middleware. The caller passes one `context` with what every plugin asks for.
- **Validated before the hooks**: a context that does not fit throws a `ZodError` with its issues
  under `['context', …]`.
- **Forwarded as written**: the `context` stays in `args.options`, so a hook that dispatches another
  operation with `args.options` passes it on. mongozod removes it before calling the driver, and
  `populate` passes it to the reads of the models it populates.
- **Deletes that become updates**: next to `softDelete`, a delete becomes an update with the options
  of the delete, so a plugin that asks for a context in the updates asks for it in the deletes too
  (see [Plugins](../guides/plugins.md#context)).

## Hooks

`hooks` takes the hooks of an operation, such as `find` or `deleteOne`, or of a group, which joins
the operations that have a filter:

| Group    | Operations                                                                       |
| -------- | -------------------------------------------------------------------------------- |
| `read`   | `find`, `findOne`, `countDocuments`, `distinct`                                  |
| `insert` | `insertOne`, `insertMany`                                                        |
| `update` | `updateOne`, `updateMany`, `replaceOne`, `findOneAndUpdate`, `findOneAndReplace` |
| `delete` | `deleteOne`, `deleteMany`, `findOneAndDelete`                                    |
| `bulk`   | `bulkWrite`                                                                      |

`aggregate` and `estimatedDocumentCount` have no filter and no group: only their own hooks and the
middleware run on them, and they take no context.

| Hook     | Receives                              | Returns                                                                                                     |
| -------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `before` | `{ operation, args, context, model }` | `{ args }` to go on with other arguments, `{ result }` to skip the operation, or nothing. A throw stops it. |
| `after`  | the same, plus `result`               | `{ result }` to replace the result, or nothing.                                                             |

- **A `before` sees the call as written**: before mongozod validates it, fills `timestamps`, or
  plans the virtuals and `populate`. Its documents are the input of the schema, without defaults, so
  a hook can fill a required field.
- **An `after` sees the final result**, the one the caller gets.
- **Layers**: the plugins run in the order of the model's list, the first one around the rest, so
  its `before` hooks run first and its `after` hooks last. A `before` that returns `{ result }`
  skips the hooks of the next plugins and the operation; the `after` hooks of its plugin and of the
  previous ones still run.
- **A group and an operation**: when a plugin has both for an operation, the `before` hooks run from
  the group to the operation, and the `after` hooks the other way around.
- **`model`** is the model, typed as `AnyModel`: its operations take and return `Document`s, and go
  through every plugin again. That is how `softDelete` turns a delete into an update, so
  `timestamps` and the other plugins see an update.
- **Cursors**: the `before` hooks of `find` and `aggregate` run once, when the cursor starts, and
  see the modifiers of the cursor in `args.options`: `sort`, `limit`, `skip` and the `projection` of
  `.project()`. Their `after` hooks, and the middleware, run once per batch the server returns,
  with the documents of that batch as the `result`.

In a group hook, `args` and `result` are the union of the operations of the group. A `before` that
only changes the filter works as is, since every operation of the group has one. To return a
`result`, or arguments of one operation, narrow `operation` first:

```ts
/** Caps the documents a `find` returns at 100. */
export function readCap() {
  return definePlugin({

    id: 'readCap',

    hooks: {

      read: {

        before({ args, operation }) {

          if (operation !== 'find') return

          const limit = Math.min(args.options.limit || 100, 100)

          return { args: { ...args, options: { ...args.options, limit } } }
        }
      }
    }
  })
}
```

An operation with `updatePipeline: true` takes a pipeline, an array of stages, as its update, so
`update` is typed as `Document | Document[]`: a hook that changes it adds a `$set` stage to a
pipeline instead of writing in its `$set`.

### Example: audit

This plugin stores in `updatedBy` the user who made the last write of each document, from the
context of each call. It fills the field on every insert and replacement, sets it in every update,
pipelines included, and covers `bulkWrite`. It asks for the context in the deletes too, for the
updates that `softDelete` makes of them.

```ts
import type { Document } from 'mongodb'

const actorContext = z.object({

  actor: mz.objectId()
})

/** A document to write, with its writer. */
function withWriter(document: Document, actor: ObjectId): Document {
  return { ...document, updatedBy: actor }
}

/** An update that also sets the writer: in its `$set`, or in one more stage of a pipeline. */
function updateWithWriter(update: Document | Document[], actor: ObjectId): Document | Document[] {
  return Array.isArray(update)
    ? [...update, { $set: { updatedBy: actor } }]
    : { ...update, $set: { ...update.$set, updatedBy: actor } }
}

/** One operation of a `bulkWrite`, with its writer. */
function bulkWithWriter(operation: Document, actor: ObjectId): Document {

  const { insertOne, replaceOne, updateMany, updateOne } = operation

  if (insertOne) {
    return { insertOne: { document: withWriter(insertOne.document, actor) } }
  }
  if (replaceOne) {
    return { replaceOne: { ...replaceOne, replacement: withWriter(replaceOne.replacement, actor) } }
  }
  if (updateOne) {
    return { updateOne: { ...updateOne, update: updateWithWriter(updateOne.update, actor) } }
  }
  if (updateMany) {
    return { updateMany: { ...updateMany, update: updateWithWriter(updateMany.update, actor) } }
  }

  return operation
}

/** Stores in `updatedBy` the user who made the last write of each document. */
export function audit() {
  return definePlugin({

    id: 'audit',

    fields: {

      updatedBy: mz.objectId()
    },

    fills: ['updatedBy'],

    context: {

      insert: actorContext,

      update: actorContext,

      delete: actorContext,

      bulk: actorContext
    },

    hooks: {

      insert: {

        before({ args, context, operation }) {

          if (operation === 'insertOne') {
            return { args: { ...args, document: withWriter(args.document, context.actor) } }
          }

          const documents = args.documents.map((document) => withWriter(document, context.actor))

          return { args: { ...args, documents } }
        }
      },

      update: {

        before({ args, context }) {

          if ('replacement' in args) {
            return { args: { ...args, replacement: withWriter(args.replacement, context.actor) } }
          }

          return { args: { ...args, update: updateWithWriter(args.update, context.actor) } }
        }
      },

      bulkWrite: {

        before({ args, context }) {

          const operations = args.operations.map((operation) =>
            bulkWithWriter(operation, context.actor)
          )

          return { args: { ...args, operations } }
        }
      }
    }
  })
}

const AuditedPostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema.extend({

    updatedBy: mz.objectId()
  }),

  plugins: [audit()]
})

const actor = new ObjectId() // the `_id` of the user who makes the change

// `updatedBy` is optional: the plugin fills it.
await AuditedPostsModel.insertOne(
  { title: 'Hello, MongoDB', body: 'A first post.', authorId: actor },
  { context: { actor } }
)
```

### Skip the operation

A `before` that returns `{ result }` answers instead of the operation. `softDelete` does it to turn
a delete into an update, dispatched through `model` with the options of the delete. This is the core
of its `deleteOne`, without the rest of the plugin:

```ts
const markDeleted = definePlugin({

  id: 'markDeleted',

  fields: {

    deletedAt: mz.date()
      .optional()
  },

  hooks: {

    deleteOne: {

      async before({ args, model }) {

        const result = await model.updateOne(
          args.filter,
          { $set: { deletedAt: new Date() } },
          args.options
        )

        return { result: { acknowledged: result.acknowledged, deletedCount: result.modifiedCount } }
      }
    }
  }
})
```

The result has to have the shape of the operation's, here a `DeleteResult`: plugins see documents
as `Document`, so TypeScript does not catch a result of another shape.

## Middleware

`middleware` wraps the whole operation, for what has to happen before and after it at once, such as
measuring its time, like the `logger` above, or running it in a transaction. `next()` runs the rest
of the operation, the hooks of this plugin and the next layers, and returns its result, which the
middleware returns. `next({ session })` also passes the session of a transaction to the operation:

```ts
import type { Operation } from 'mongozod'

const WRITES = new Set<Operation>([
  'bulkWrite',
  'deleteMany',
  'deleteOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'insertMany',
  'insertOne',
  'replaceOne',
  'updateMany',
  'updateOne'
])

/** Records each write in an `outbox` collection, in the same transaction as the write. */
export function outbox() {
  return definePlugin({

    id: 'outbox',

    async middleware({ model, next, operation }) {

      if (!WRITES.has(operation)) return next()

      return model.db.client.withSession((session) =>
        session.withTransaction(async () => {

          const result = await next({ session })

          await model.db
            .collection('outbox')
            .insertOne({ collection: model.name, operation, at: new Date() }, { session })

          return result
        })
      )
    }
  })
}
```

A transaction needs a replica set or a sharded cluster, as the
[MongoDB manual](https://www.mongodb.com/docs/manual/core/transactions/) says. In `find` and
`aggregate`, the middleware wraps each batch, and `next()` ignores the session: a cursor keeps the
one it starts with.

**Hooks or middleware?** A hook changes the arguments or the result, and runs once per operation,
or once per batch for an `after` of a cursor. A middleware is for what needs the before and the
after in the same function, such as a timer or a transaction.

## Methods

`methods` adds methods to the model. A method declares `this` as a generic model, so it takes the
types of each model it is added to: `filter` is checked like the filter of the model's own
operations, and `...options` forwards the options of the operation, `context` included.

```ts
import type { AnyModel, FilterOf, ReadOptionsArg, UpdateOf, UpdateOptionsArg } from 'mongozod'

export function helpers() {
  return definePlugin({

    id: 'helpers',

    methods: {

      /** True when at least one document matches the filter. */
      async exists<M extends AnyModel, const F extends FilterOf<M, F>>(
        this: M,
        filter: F,
        ...options: ReadOptionsArg<M>
      ) {
        return (await this.countDocuments(filter, { ...options[0], limit: 1 })) > 0
      },

      /** Updates the first document that matches, and throws when none does. */
      async updateOneOrFail<
        M extends AnyModel,
        const F extends FilterOf<M, F>,
        const U extends UpdateOf<M, U, F>
      >(this: M, filter: F, update: U, ...options: UpdateOptionsArg<M>) {

        const result = await this.updateOne(filter, update, options[0])

        if (result.matchedCount === 0) throw new Error(`${this.name}: no document matches`)

        return result
      }
    }
  })
}

const HelpedPostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  plugins: [helpers()]
})

await HelpedPostsModel.exists({ status: 'published' })

// @ts-expect-error: a title is a string
await HelpedPostsModel.updateOneOrFail({ title: 'Hello' }, { $set: { title: 1 } })
```

Two plugins that define the same method, or a method named like a member of the model, such as
`find`, do not compile, and `mongozod()` throws an `Error`.

## Types for plugins

A method types its filter or its update with the types for services, such as `FilterOf` and
`UpdateOf` (see [TypeScript](../guides/typescript.md#types-for-services-and-repositories)). These
are the types of a plugin's own:

| Type                  | What it is                                                                          |
| --------------------- | ----------------------------------------------------------------------------------- |
| `AnyModel`            | Any model, as hooks and methods see it: its operations take and return `Document`s. |
| `ReadOptionsArg<M>`   | The options argument of the reads of `M`, with the context its plugins ask for.     |
| `UpdateOptionsArg<M>` | The options argument of the updates of `M`, with the context its plugins ask for.   |
| `Plugin`              | The type `definePlugin` returns.                                                    |

The [API reference](../api/mongozod.md#types-for-plugins) lists the rest, such as `Operation`,
`Group` and `OperationArgs`.

## Annotate a factory

Leave the return type of a factory to inference: `definePlugin` infers each part, `fills` as a
tuple. When you annotate it, the type parameters of `Plugin` are the `id`, the `fields`, the
`options`, the `context`, the `methods` and the `fills`, and the last one names the fields it fills:

```ts
import type { Plugin } from 'mongozod'

type TenantPlugin = Plugin<'tenant', { tenantId: z.ZodString }, {}, {}, {}, readonly ['tenantId']>
```

Without that tuple, as `Plugin<'tenant', { tenantId: z.ZodString }>` or `Plugin`, the plugin fills
no field for the types, whatever its hooks do: TypeScript does not look at the body, so the inserts
of its models require `tenantId`.

## Common mistakes

- **Returning `{ args }` without the rest of the arguments**: build them with `{ ...args, … }`, and
  the options with `{ ...args.options, … }`. A lost option drops the `session` of a transaction, or
  the `context` that the next plugins need.
- **Writing in `args.update.$set` without checking for a pipeline**: an update with
  `updatePipeline: true` is an array. Add a `$set` stage to it instead.
- **Returning a `result` from a group hook without narrowing `operation`**: each operation has a
  result of its own shape, and TypeScript does not catch the wrong one. Narrow it first.
- **Dispatching through `model.collection`**: it is the driver's collection, which skips the
  validation, `timestamps` and every plugin. Dispatch through `model`, with `args.options`.
- **Declaring `fills` and leaving out a write**, such as `insertMany`, `findOneAndReplace` or the
  inserts of `bulkWrite`: it compiles without the field and throws the `ZodError` of the schema.
  Cover every insert and replacement.
- **Reading the documents of a `before` as validated**: they are the input as the caller wrote it,
  without defaults, and a date may still be an ISO string. Check what the hook relies on: the schema
  validates the document only after the hooks.
- **Not returning the result of `next()`** from a middleware: the operation resolves to what the
  middleware returns.
- **Asking for a context in the updates only**: next to `softDelete`, a delete compiles without it
  and the update it becomes throws a `ZodError`. Ask for it in the `delete` group too.
