<h1 align="center">MongoZod</h1>

<p align="center">
  The Mongoose alternative built on Zod and the official MongoDB® driver.<br />
  One schema validates every write, types every read and defines what each endpoint accepts.
</p>

<p align="center">by <a href="https://x.com/tserdeiro">@tserdeiro</a></p>

<p align="center">
  <a href="https://github.com/tserdeiro/mongozod/actions/workflows/ci.yml"><img src="https://github.com/tserdeiro/mongozod/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" /></a>
  <a href="https://www.npmjs.com/package/mongozod"><img src="https://img.shields.io/npm/v/mongozod" alt="npm version" /></a>
  <a href="https://github.com/tserdeiro/mongozod/blob/main/LICENSE"><img src="https://img.shields.io/github/license/tserdeiro/mongozod" alt="License" /></a>
</p>

<p align="center">
  <a href="https://mongozod.dev/docs">Docs</a>
  &nbsp;•&nbsp;
  <a href="https://mongozod.dev/docs/mongoose">Migrating from Mongoose</a>
  &nbsp;•&nbsp;
  <a href="https://x.com/tserdeiro">𝕏</a>
</p>

> [!NOTE]
> MongoZod is an independent open-source project. It is not affiliated with, endorsed by or
> sponsored by MongoDB, Inc. MongoDB® is a registered trademark of MongoDB, Inc.

## What is MongoZod?

MongoZod is a library for MongoDB where a [Zod](https://zod.dev) schema is the single source of
truth for each document: it validates what you write, types what you read and defines what each
endpoint accepts. It complements the official driver instead of replacing it: a model mirrors the
driver's operations, options and results, and the driver stays at hand for everything else.

- **One schema**: Zod or Zod Mini describes the stored document. Writes are typed with its input
  and reads with its output.
- **Every write validated**: inserts, replacements and each value of each update operator, with
  refinements, async ones included. An upsert also validates the document it would insert.
- **Strict types**: filters, updates, projections and sorts with every MongoDB operator, dotted
  paths checked against the schema, and projections that narrow the result.
- **What you used in Mongoose**: `populate`, virtuals, timestamps, discriminators, indexes,
  `$jsonSchema` validation and plugins, such as soft delete.
- **Endpoint inputs**: `mongozod/mzod` builds Zod schemas that accept MongoDB syntax from clients,
  limited to what each endpoint declares, and BSON field types, like `ObjectId`, `Decimal128` and
  GeoJSON. It never imports the driver, so it runs in browsers too.
- **Light on the editor**: CI caps the type instantiations of a typical project.

## Why not Mongoose?

|                       | Mongoose 9                                                                                                                                                  | MongoZod                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Schema                | A Mongoose schema, apart from what validates your endpoints                                                                                                 | One Zod schema for the document, its types and the inputs of your endpoints                |
| Update validation     | [Off by default](https://mongoosejs.com/docs/validation.html#update-validators), and only on `$set`, `$unset`, `$push`, `$addToSet`, `$pull` and `$pullAll` | Always, on every operator, and on the document an upsert would insert                      |
| Filters               | [Cast at runtime](https://mongoosejs.com/docs/tutorials/query_casting.html): a value that cannot be cast throws a `CastError`                               | Typed: a value of the wrong type does not compile, and what clients send is parsed by `mz` |
| Results               | Documents that track changes, or plain objects with `lean()`                                                                                                | The driver's plain objects, typed by the projection and `populate`                         |
| Nested discriminators | [The most upvoted open issue](https://github.com/Automattic/mongoose/issues/2851)                                                                           | A `z.discriminatedUnion` inside another, up to three levels                                |
| Driver                | Mongoose's own API on top of the driver                                                                                                                     | The driver's signatures, options and results, and the driver itself for everything else    |

Both run on the same connection, so you can [migrate one model at a time](https://mongozod.dev/docs/mongoose).

## Installation

```sh
npm install mongozod
```

MongoZod uses the Zod and the MongoDB driver of your project: `zod@^4.5.0`,
`mongodb@^6.20.0 || ^7.0.0` and `bson` of the same major as the driver are its peer dependencies,
which npm and pnpm install when they are missing (with Yarn, add them yourself). It needs Node.js
22.15 or later and TypeScript 5.5 or later with `strict`.

> [!WARNING]
> MongoZod is in 0.x: its API may change in a minor version.

## Basic usage

### Define a model

```ts
import { MongoClient, ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const client = new MongoClient('mongodb://localhost:27017')

const postSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  title: z.string()
    .min(1),

  status: z.enum(['draft', 'published'])
    .default('draft'),

  tags: z.string()
    .array()
    .default([]),

  createdAt: mz.date(),

  updatedAt: mz.date()
})

const PostsModel = mongozod({

  collection: 'posts',

  db: client.db(),

  schema: postSchema,

  timestamps: true
})
```

### Write and read

```ts
const { document: post } = await PostsModel.insertOne({ title: 'Hello, MongoDB' })
// { _id: ObjectId('…'), title: 'Hello, MongoDB', status: 'draft', tags: [], createdAt, updatedAt }

await PostsModel.updateOne({ _id: post._id }, { $set: { status: 'published' } })

const titles = await PostsModel.find({ status: 'published' }, { projection: { title: 1 } })
// titles: Array<{ _id: ObjectId; title: string }>
```

Each write throws a `ZodError` when it doesn't fit the schema, and the types catch most mistakes
first:

```ts
// @ts-expect-error: 'archived' is not a status
await PostsModel.updateOne({ _id: post._id }, { $set: { status: 'archived' } })
```

### Accept queries from clients

`mongozod/mzod` turns the schema into the inputs of your endpoints. A client sends MongoDB syntax,
and only what the endpoint declares gets through:

```ts
const posts = mz.from(postSchema)

const listPostsInput = z.object({

  filter: posts
    .filter({
      status: ['$eq'],
      tags: ['$in']
    })
    .default({}),

  options: z
    .object({

      sort: posts
        .sort({
          createdAt: true,
          title: true
        })
        .default({ createdAt: -1 }),

      limit: z.number()
        .int()
        .min(1)
        .max(100)
        .default(20)
    })
    .prefault({})
})

// The body of a request, such as { "filter": { "tags": { "$in": ["mongodb"] } } }
export async function listPosts(body: unknown) {

  const { filter, options } = listPostsInput.parse(body)

  return PostsModel.find(filter, options)
}
```

## Documentation

Read the [documentation](https://mongozod.dev/docs) for the
guides, the recipes and the API reference, and
[Migrating from Mongoose](https://mongozod.dev/docs/mongoose)
to move a project over.

The docs also ship in the package, in `node_modules/mongozod/dist/docs/`, at the installed version.
To point your coding agent at them, add this to your `AGENTS.md`:

```md
<!-- BEGIN:mongozod-agent-rules -->

## mongozod

Before writing code that uses mongozod, read the relevant guide in
`node_modules/mongozod/dist/docs/`, starting from its `README.md`. Resolve it from the package that
depends on mongozod: in a monorepo it may not be at the repository root. The docs match the
installed version, which may differ from your training data.

<!-- END:mongozod-agent-rules -->
```

## Security

To report a vulnerability, report it privately, as the
[security policy](https://github.com/tserdeiro/mongozod/security/policy) says.

## License

[Apache 2.0](https://github.com/tserdeiro/mongozod/blob/main/LICENSE)
