---
title: Auto index
description: Create the indexes a model declares on its first operation, with the autoIndex plugin, for development, tests and serverless platforms.
---

`autoIndex` creates the indexes a model declares on its first operation in each database, as
Mongoose's `autoIndex` does. It is for development, tests and platforms without a step that runs
[`sync()`](../guides/sync.md) before the app takes requests, such as a serverless one. It comes
from `mongozod/plugins/auto-index`.

```ts
import { mongozod } from 'mongozod'
import { autoIndex } from 'mongozod/plugins/auto-index'
import * as z from 'zod'

const usageSchema = z.object({

  organization: z.string(),

  count: z.number()
    .int()
})

const UsagesModel = mongozod({

  collection: 'usages',

  db,

  schema: usageSchema,

  indexes: (index) => [
    index({ organization: 1 }, { unique: true })
  ],

  plugins: [autoIndex()]
})

// The first operation creates the unique index, then upserts.
await UsagesModel.updateOne({ organization: 'acme' }, { $inc: { count: 1 } }, { upsert: true })
```

## What it does

- **Once per database**: the first operations of a model in a database wait for one
  `createIndexes`, which does nothing when the indexes exist. Operations that start at the same
  time share it. A model whose `db` is a function, such as one database per tenant, builds them in
  each database it reads.
- **Every operation**: reads and writes, cursors included, so a unique index exists before the
  first write relies on it.
- **Indexes only**: it does not apply the [`$jsonSchema`](../guides/sync.md#jsonschema), which
  needs `collMod`, an action of `dbAdmin` that the application's user does not have. `sync()`
  applies it.
- **When it fails**, such as a unique index over repeated values, the operation that started the
  build throws the server's error, and the next operation tries again. A unique index that cannot
  be built repeats the build on each operation until the data is fixed.

## When to use it

`sync()` from a deploy step is still the way for production: an index build on a large collection
delays the operations that wait for it, and a failure shows up in the deploy and not in a request.
`autoIndex` fits where there is no such step:

- **Tests**: a test that relies on a unique index gets it without calling `sync()` in its setup.
- **Development**: a new index is there on the next run.
- **Serverless platforms**: each new instance sends one `createIndexes`, which costs little when
  the indexes exist.

See [When to run it](../guides/sync.md#when-to-run-it) for the other ways.

## Reference

`autoIndex()` takes no arguments.

| Part    | Value                                 |
| ------- | ------------------------------------- |
| Fields  | None                                  |
| Options | None                                  |
| Context | None                                  |
| Methods | None                                  |
| Hooks   | A `middleware` around every operation |

## Common mistakes

- **Expecting it to drop or change an index**: like `sync()`, it never drops one, and a changed
  index fails with the code 85 or 86 on each operation. Drop the old one with
  `model.collection.dropIndex()`.
- **Expecting the `$jsonSchema`**: run `sync()` for it, with a user that has `dbAdmin`.
