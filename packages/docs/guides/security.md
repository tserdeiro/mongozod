---
title: Security
description: What MongoZod protects against when an endpoint takes a query from a client, and what stays with your application.
---

An endpoint that takes a filter, an update or a projection from a client parses it with an
[`mz` builder](./endpoint-inputs.md) first. The builder accepts only what it declares, and the
router joins its output with what the server decides, such as who owns the documents:

```ts
import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const postSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  authorId: mz.objectId(),

  status: z.enum(['draft', 'published']),

  title: z.string()
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema
})

const listPostsInput = z.object({

  filter: mz
    .filter(postSchema, {
      status: ['$eq'],
      title: ['$eq']
    })
    .default({}),

  projection: mz.projection(postSchema, {
    status: true,
    title: true
  })
})

export async function listPosts(body: unknown, userId: ObjectId) {
  const input = listPostsInput.parse(body)

  return PostsModel.find(
    { $and: [input.filter, { authorId: userId }] },
    { limit: 20, projection: input.projection }
  )
}
```

## What the builders guarantee

- **Fields and operators**: `mz.filter` accepts the paths and the operators it declares, and
  anything else fails with a `ZodError`. `$where`, `$expr` and `$function` are never accepted (see
  [`$where` and `$expr`](./endpoint-inputs.md#where-and-expr)), and MongoZod never runs JavaScript
  on the server itself.
- **Values**: each value is parsed with the schema of its field, so an id is an `ObjectId` and a
  date is a `Date`. No value can be an object with a key that starts with `$`, even on a field
  typed `z.record()` or `z.unknown()`, so a client can't send `{ "$ne": null }` as a value. Nor a
  regular expression, which MongoDB matches as a pattern: a pattern only enters through a declared
  `$regex`. The checks run on what the client sends and on what the schema returns, so a transform
  that parses JSON or builds a `RegExp` can't produce one either.
- **Updates**: `mz.update` accepts the paths each operator declares. It can't declare the `_id`,
  and on a model with [timestamps](./timestamps.md) the model rejects `createdAt` and `updatedAt`.
  No value of `$set` can have a key with a `.` or starting with `$`, at any level, even on a field
  typed `z.record()` or `z.unknown()`. The model validates every write against the schema again.
- **Projections and populate**: the mask of `mz.projection` is the most a client gets, whatever it
  sends, and `mz.populate` returns the fields of the first level of the schema it picks: a field
  that is an object comes whole (see [`mz.populate`](./endpoint-inputs.md#mzpopulate)).
- **Keys such as `__proto__`**: the builders reject them. When a write reaches the model with one
  in a path or a value, it is a field name, as MongoDB stores it, and never reaches
  `Object.prototype`.

## What stays with your application

### Authorization

The builders limit what a client can express, not which documents it may touch. Join the client's
filter with your scope with `$and`, as above: `{ ...scope, ...input.filter }` lets a client
replace a key of the scope. A field that says who owns a document, such as `authorId`, comes from
the session, never from the request.

### Values that skip the builders

The types of a model method check a filter at compile time only. A request body is often typed
`any`, so it compiles, and MongoDB reads an object of operators as operators:

```ts
declare const request: { body: any }

// Compiles, and a body of { "title": { "$ne": null } } matches every post.
await PostsModel.findOne({ title: request.body.title })
```

Parse the input of the request once, at the endpoint, with a schema that comes from the one of the
document: `.pick()` for values, or `mz.filter` when the client sends a filter. A framework that
validates its inputs, such as tRPC with `.input()`, does this step for you.

```ts
const findPostInput = postSchema.pick({ title: true })

const { title } = findPostInput.parse(request.body)

await PostsModel.findOne({ title })
```

The model can't do it alone. The schema describes values, and an injection is an operator: a
`{ title: { $ne: null } }` that your code writes, which is a valid filter, reaches the model the
same as one a client sent. What a client may send is a decision of each endpoint, which its input
declares.

A value that is missing is the other half of this. The driver sends an `undefined` value as
`null`, which matches the documents without the field, so a request without a token would match
the users that have none:

```ts
import type { AnyModel } from 'mongozod'

declare const UsersModel: AnyModel

// Throws a ZodError when the body has no token: the driver would send { resetToken: null }.
await UsersModel.findOne({ email: request.body.email, resetToken: request.body.token })
```

The types of the model reject an `undefined` value, and the model throws a `ZodError` at runtime
for the ones that arrive typed `any`, at any level of the filter. Leave the key out, or write `null`
or `{ $exists: false }` when that is what you mean.

The same goes for inserts: a body parsed with the whole schema lets a client choose the `_id`,
`createdAt` or a field of a plugin, such as `deletedAt`. Parse it with `.pick()` of the fields a
client may write.

### Cost

The builders don't cap how much a request asks for. Limit the size of the request body, and:

- **Arrays**: `$in`, `$nin` and `$all` take arrays of any length. Cap them with a `.refine()` on
  the filter when a large one would hurt.
- **`$and` and `$or`**: a recursive filter nests without a limit. Declare one level with
  `.max()` on its arrays (see [`$and`, `$or` and `$nor`](./endpoint-inputs.md#and-or-and-nor)).
- **`$regex`**: a client sends any pattern, and one that isn't anchored to the start reads the
  whole collection or index. For a search box, prefer `$text` or MongoDB Search, or
  [`mz.term`](../api/mzod.md#mzterm), which builds the regex from an escaped term; give the term a
  maximum length (see [Search](../recipes/search.md)).
- **Pages**: cap `limit` with `.max()`, and the page number of skip pagination too, since a large
  `skip` still reads every document before it. [`mz.after`](./pagination.md) doesn't skip.
- **Time**: the driver's `maxTimeMS` option, which a model method takes, stops a query that runs
  too long.

### Sensitive fields

A read returns the whole document unless it projects, and MongoZod has no `select: false` yet. Keep
fields such as a password hash out of every mask, exclude them in the reads the server makes, or
parse what you return with a schema that leaves them out, such as
`userSchema.omit({ passwordHash: true })`.

### Plugins

`aggregate`, `$lookup` and the driver's collection skip plugins, so a pipeline reads the documents
that [soft delete](../plugins/soft-delete.md) hides. Don't declare `deletedAt` in a client's
`mz.filter`: a filter that mentions it reads the deleted documents, and a delete with it removes
them for real.

### `$rename`

The types check that `$rename` moves a value between compatible fields, and the runtime only checks
that the new path exists. Don't take a `$rename` from a client: `mz.update` doesn't offer it.

### Errors

Return `z.flattenError(error)` for a `ZodError` from parsing a request, which says what the client
sent wrong. A `ZodError` from a write means the server built something the schema rejects: log it
and answer with a 500. Some issues that MongoZod adds carry the value in `input`, which can be the
whole filter with your scope, so don't return `error.issues` as they are. The same goes for driver
errors, such as the `keyValue` of a duplicate key, which tells a client which email exists.

### Server-side JavaScript

A filter of a model, an `aggregate` pipeline and an update with `updatePipeline: true` reach the
server as you write them, `$where`, `$function` and `$accumulator` included: they are the driver's.
Never build one from what a client sends, and disable server-side scripting when the application
doesn't use them, with `security.javascriptEnabled: false`, as the MongoDB security checklist says
(see [The server](../getting-started/connection.md#the-server)).

### The connection

Read the connection string from the environment, as the
[OWASP NoSQL Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/NoSQL_Security_Cheat_Sheet.html)
recommends, and connect with a user that has `readWrite` on its database and nothing more:
`sync()` with `jsonSchema` needs `dbAdmin`, so it runs from a deploy step with another user. The
client options that matter, and what the server side needs, are in
[Connection](../getting-started/connection.md).

## From Mongoose

| Mongoose               | MongoZod                                                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sanitizeFilter: true` | Parse each request value with `mz.filter`, `mz.objectId()` or a Zod schema: model methods don't sanitize.                                                                  |
| `strictQuery`          | A path outside the schema doesn't compile, and `mz.filter` rejects undeclared paths at runtime. An `undefined` value doesn't compile, and the model rejects it at runtime. |
| `mongoose.trusted()`   | Not needed: a filter the server builds goes to the model as it is.                                                                                                         |
| `select: false`        | Not there yet: see [Sensitive fields](#sensitive-fields).                                                                                                                  |

## Reporting a vulnerability

Report it privately, as the
[security policy](https://github.com/tserdeiro/mongozod/security/policy) says.
