---
title: Installation
description: Install MongoZod, and the versions of Node.js, TypeScript, Zod and the MongoDB driver it needs.
---

```npm
npm install mongozod
```

MongoZod uses the Zod and the MongoDB driver of your project, which are its
[peer dependencies](#peer-dependencies): npm and pnpm install them when they are missing.

> [!WARNING]
> MongoZod is in 0.x: its API may change in a minor version. Each change is in the changelog of its
> release.

## Requirements

| Dependency | Version                     | Why                                                                                                                                                |
| ---------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js    | 22.15 or later              | The cursors of `find` and `aggregate` run in the async context where they were created, with `AsyncLocalStorage.snapshot()`, stable since 22.15.   |
| TypeScript | 5.5 or later, with `strict` | The types of filters, updates and projections rely on it. They are also tested with TypeScript 7 and `exactOptionalPropertyTypes`.                 |
| `zod`      | `^4.5.0`                    | Zod 4 or Zod Mini. Zod 3 is not supported.                                                                                                         |
| `mongodb`  | `^6.20.0 \|\| ^7.0.0`       | Driver 6.20 is the one of Mongoose 8.19 and later, and driver 7 the one of Mongoose 9, so both libraries can share a connection while you migrate. |
| `bson`     | The major of your driver    | The field types of `mongozod/mzod`, like `mz.objectId()`, build BSON values with it. Driver 7 uses `bson` 7, and driver 6 uses `bson` 6.           |
| MongoDB    | 8.x                         | The server MongoZod is tested against.                                                                                                             |

Bun works too: the tests also run on its latest version.

## Peer dependencies

`zod`, `mongodb` and `bson` are peer dependencies, not dependencies of MongoZod: it works with the
copies your project uses, so the `MongoClient` you create and the schemas you write are the ones it
receives. A second copy of the driver would not even compile when you pass your `Db` to a model.

npm (since version 7) and pnpm install the peer dependencies that are missing, but Yarn does not:
with Yarn, add `zod`, `mongodb` and `bson` to your `package.json` yourself.

`bson` must be the same major as the one your driver depends on, because the driver only
serializes the BSON values of its own major. Check it with `npm ls bson`.

## TypeScript

MongoZod is published as ESM only, with its declarations. Use a `moduleResolution` that reads the
`exports` of a package, which is any of `node16`, `nodenext` and `bundler`:

```json
{
  "compilerOptions": {
    "strict": true,
    "module": "nodenext",
    "moduleResolution": "nodenext"
  }
}
```

## Entry points

| Import                         | What it has                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mongozod`                     | `mongozod()`, which defines a model, `definePlugin` and the public types. See the [API reference](../api/mongozod.md).                                                      |
| `mongozod/mzod`                | The Zod of MongoDB: the BSON field types and the builders of endpoint inputs. It never imports the driver, so it runs in browsers. See the [API reference](../api/mzod.md). |
| `mongozod/plugins/auto-index`  | The official [`autoIndex`](../plugins/auto-index.md) plugin.                                                                                                                |
| `mongozod/plugins/soft-delete` | The official [`softDelete`](../plugins/soft-delete.md) plugin.                                                                                                              |

Import `mongozod/mzod` as a namespace, as you import Zod, so a bundler keeps only what you use:

```ts
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const tagSchema = z.object({

  _id: mz.objectId(),

  name: z.string()
})
```

## Next steps

Follow the [Quick start](./quick-start.md) to define a model, write, read and accept queries from
a client.
