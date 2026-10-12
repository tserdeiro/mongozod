---
title: Validation
description: What MongoZod validates on each write, how it checks upserts, and the ZodError it throws when a write does not fit.
---

Every write goes through the schema before it reaches the driver. When something does not fit,
the operation throws Zod's `ZodError`, with every problem it found, and writes nothing.

```ts
import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const postSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  title: z.string()
    .min(1),

  body: z.string()
    .default(''),

  status: z.enum(['draft', 'published'])
    .default('draft'),

  tags: z.string()
    .array()
    .default([]),

  authorId: mz.objectId(),

  views: z.number()
    .int()
    .min(0)
    .default(0),

  publishedAt: mz.date()
    .optional()
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema
})

const authorId = new ObjectId()

try {
  await PostsModel.insertOne({ title: '', authorId })
} catch (error) {
  if (error instanceof z.ZodError) console.log(error.issues)
  // [{ code: 'too_small', path: ['title'], message: 'Too small: expected string to have >=1 characters', … }]
}
```

| Write                                                                        | Validated with                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------- |
| `insertOne`, `insertMany` and the inserts of `bulkWrite`                     | The whole schema                                |
| `replaceOne`, `findOneAndReplace` and the replacements of `bulkWrite`        | The whole schema, as an insert                  |
| `updateOne`, `updateMany`, `findOneAndUpdate` and the updates of `bulkWrite` | Each value, with the schema of its path         |
| An upsert                                                                    | Also the document it would insert, as an insert |
| An update pipeline, with `updatePipeline: true`                              | Nothing: the server computes its values         |
| Reads                                                                        | Nothing                                         |

Writes validate with `parseAsync`, so what they parse goes through its refinements, async ones
included, its defaults, its transforms and its codecs, and the database stores what Zod returns.

## Inserts

`insertOne` validates the document with the schema and stores its output. On the way, MongoZod
drops the keys left `undefined`, which the driver would store as `null`, and rejects a key with a
`.` or starting with `$`, such as one of a `z.record()`, because no path reaches it.

`insertMany` and `bulkWrite` validate the whole batch before writing: if one document or operation
fails, they write nothing and throw one `ZodError` with the issues of every one that fails, each
under its index:

```ts
try {
  await PostsModel.insertMany([
    { title: 'Schemas', authorId },
    { title: '', authorId }
  ])
} catch (error) {
  if (error instanceof z.ZodError) console.log(error.issues.map((issue) => issue.path))
  // [[1, 'title']], and no document was written
}
```

That holds with `ordered: false` too, which only lets the other documents through on the server's
errors, such as a duplicate key.

## Replacements

`replaceOne` and `findOneAndReplace` validate the replacement like an insert: it takes the input of
the schema, and its defaults, its transforms and the refinements of the whole document run.

The replacement writes its `_id` only when you pass it, since the `_id` of a document cannot
change: the one its `.default()` generates is dropped. With `upsert: true`, the server inserts the
replacement with its own `_id` or, without one, with the `_id` of the filter, so a schema that
declares `_id` needs it in the replacement or by equality in the filter, and MongoZod validates the
replacement with it. Without either, the operation throws a `ZodError`, and so does a `null` `_id`
in the filter, or one that the schema does not take.

## Updates

An update has no document to validate: it writes paths. MongoZod validates each value with the
schema of its path, with its refinements, defaults and transforms, and writes what Zod returns. An
ISO string in a `mz.date()` field arrives as a `Date`:

```ts
const { document: post } = await PostsModel.insertOne({ title: 'Hello, MongoDB', authorId })

await PostsModel.updateOne(
  { _id: post._id },
  { $set: { status: 'published', publishedAt: '2026-10-12T09:00:00Z' } }
)
```

Each operator has its rules, which the types check too (see [TypeScript](./typescript.md#updates)).
At runtime they cover what the types cannot see, such as an update built at runtime:

| Operator                               | Rule                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$set`, `$setOnInsert`, `$min`, `$max` | The value is parsed with the schema of its field.                                                                                                                                                       |
| `$unset`                               | Only an optional field: one with `.default()` is not. Also a key of a record without a fixed set of keys, or of a catchall. On an array element, which MongoDB sets to `null`, only if it takes `null`. |
| `$inc`, `$mul`                         | Only numbers, with a whole number on an integer field. A `Decimal128` field takes a decimal.                                                                                                            |
| `$bit`                                 | Only numbers.                                                                                                                                                                                           |
| `$currentDate`                         | Only a field that takes a `Date`, with `true` or `{ $type: 'date' }`.                                                                                                                                   |
| `$push`, `$addToSet`                   | Only arrays. Each element is parsed with the schema of the elements, also in `$each`. A set of `mz.set()` takes `$addToSet`, not `$push`.                                                               |
| `$pop`, `$pull`, `$pullAll`            | Only arrays.                                                                                                                                                                                            |
| `$rename`                              | From an optional field to a path of the document, outside of arrays. The server moves the stored value without parsing it, so only the types check that both have the same type.                        |

- **The `_id`**: only `$setOnInsert` writes it, and whole: the server rejects a change of it.
- **Array elements**: a path names them with an index, `$`, `$[]` or `$[id]`, and takes `$` once,
  as MongoDB does.
- **Several types of document**: in a collection with a `z.discriminatedUnion`, each path an update
  writes has to exist in every type the filter allows, such as
  `"url" is not in every type allowed: fix "kind" in the filter` (see
  [Document types](./document-types.md)).
- **`undefined`**: a key left `undefined` is dropped, and the field keeps its value, so a partial
  update can pass an object whose keys may be `undefined`.
- **The refinements of the whole document**, such as one that compares two fields, do not run on
  updates, because an update has no document. To check them, read the document and replace it with
  `replaceOne`.
- **Pipelines**: an update with an aggregation pipeline needs `updatePipeline: true`, or it throws a
  `ZodError`. Its values are expressions the server computes, so they are not validated.

Mongoose, by comparison, runs update validators only when you pass `runValidators`, and only on
some operators, not on `$inc`
([Mongoose docs](https://mongoosejs.com/docs/validation.html#update-validators-only-run-for-some-operations)).

### `$inc` and the checks of a field

`$inc` and `$mul` leave out the checks of the field, such as `.min(0)`: they apply to the value,
which the server computes from the stored one. The [`$jsonSchema`](./sync.md#what-it-checks) does
not check bounds either. Guard the result in the filter, as the
[MongoDB manual](https://www.mongodb.com/docs/manual/tutorial/model-data-for-atomic-operations/)
does, so the update matches nothing when the stored value is too low:

```ts
const { modifiedCount } = await PostsModel.updateOne(
  { _id: post._id, views: { $gte: 5 } },
  { $inc: { views: -5 } }
)
// modifiedCount: 0 when views is lower than 5
```

## Upserts

With `upsert: true`, an update can insert a document, so MongoZod also validates the document the
server would insert. It builds it as MongoDB does: the equalities of the filter, then the fields
each operator creates. It validates it with the whole schema, refinements of the whole document
included, and adds the defaults it lacks with `$setOnInsert`:

```ts
await PostsModel.updateOne({ title: 'Roadmap', authorId }, { $inc: { views: 1 } }, { upsert: true })
// Inserts { _id: ObjectId('…'), title: 'Roadmap', authorId: ObjectId('…'), views: 1, body: '', status: 'draft', tags: [] }
```

A required field that neither the filter nor the update gives fails, with a message that says
where to give it:

```ts
try {
  await PostsModel.updateOne({ _id: post._id }, { $inc: { views: 1 } }, { upsert: true })
} catch (error) {
  // title: Invalid input: expected string, received undefined: an upsert inserts it, so give it in
  // the filter or with $setOnInsert
}

await PostsModel.updateOne(
  { _id: post._id },
  { $inc: { views: 1 }, $setOnInsert: { title: 'Untitled', authorId } },
  { upsert: true }
)
```

- **Every upsert**: MongoZod cannot know whether the filter will match a document, so it validates
  the document an upsert would insert even when the upsert ends up updating one. The first update
  above throws although `post` exists.
- **From the filter**: the server copies an equality, a `$eq`, a `$in` of one value, and the same
  inside `$and` or an `$or` of one filter. A regular expression matches by pattern, so it is not
  copied.
- **Values the schema changes**: the server copies the filter's value as it is, without Zod. If the
  schema would store it differently, such as an email that a transform lowercases, the upsert throws
  a `ZodError` on that path: filter by the value the schema stores.
- **A `null` `_id`**: an upsert whose filter gives the `_id` as `null`, or `undefined`, which the
  driver sends as `null`, throws a `ZodError`: it would insert a document whose `_id` is `null`.

Two operators on the same path, such as the same field in `$set` and `$setOnInsert`, are left to
the server, which rejects them.

## Async refinements

Since writes validate with `parseAsync`, a refinement can be async, such as one that checks the
database, like an [async validator](https://mongoosejs.com/docs/validation.html) of Mongoose:

```ts
const userSchema = z.object({

  name: z.string()
    .min(1),

  handle: z.string()
    .refine(
      async (handle) => (await db.collection('reserved_handles').countDocuments({ handle })) === 0,
      'is reserved'
    )
})

const UsersModel = mongozod({

  collection: 'users',

  db,

  schema: userSchema
})


// Throws a ZodError with the issue 'is reserved' when the handle is in reserved_handles.
await UsersModel.insertOne({ name: 'Admin', handle: 'admin' })
```

It runs on every write that parses the field: inserts, replacements and the updates that write it.
A refinement runs without the session of the operation, so inside a transaction it reads outside of
it. A check that has to see the transaction goes in the `before` hook of a plugin, which gets the
`session` in its options (see [Writing plugins](../plugins/writing-plugins.md)).

## The ZodError

A failed validation throws the `ZodError` of `zod`, also with Zod Mini schemas, so
`error instanceof z.ZodError` catches it in both. Its `issues` say what failed and where:

| Write                                   | Path of an issue                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Insert or replacement                   | The path in the document, such as `['title']` or `['tags', 0]`                                         |
| `insertMany` and `bulkWrite`            | The index first, such as `[1, 'title']` or `[1, '$set', 'title']`                                      |
| Update                                  | The operator, then the path as written: `['$set', 'title']`, and `['$set', 'tags.0']` for a dotted key |
| The document an upsert would insert     | The path in the document, such as `['title']`                                                          |
| An option, such as a `sort` in a string | The option, such as `['sort']`                                                                         |

`z.prettifyError()` turns it into lines for a log:

```ts
try {
  await PostsModel.updateOne({ _id: post._id }, { $set: { title: '' } })
} catch (error) {
  if (error instanceof z.ZodError) console.error(z.prettifyError(error))
  // ✖ Too small: expected string to have >=1 characters
  //   → at $set.title
}
```

The other errors are not Zod's. The driver's propagate unchanged, such as the `MongoServerError`
of a duplicate key, with `code` 11000. A configuration that cannot work throws an `Error` when the
model is defined (see [Models](./models.md#configuration-errors)).

## Reads are not validated

`find`, `findOne` and the other reads return documents as they are stored. Every write through the
model is validated, but a document written by other code, through `model.collection`, or before the
schema changed can differ from what the type of the read says.

- To make the server check the writes that skip the model, apply a `$jsonSchema` with `sync()` (see
  [Sync](./sync.md)).
- To find the stored documents that no longer fit, parse them with `safeParse` before a migration
  (see [Schema migrations](../recipes/schema-migrations.md)).
- `aggregate` validates each document when you pass it a `schema` (see
  [Aggregation](./aggregation.md)).

Two writes change more than the app can see: a `$set` with a dotted path creates the parents that
are missing, and a `$set` past the end of an array fills the gap with `null`. The `$jsonSchema` of
`sync()` covers them too.

## Common mistakes

- **A refinement that compares two fields, expected on updates**: it runs on inserts, replacements
  and the document of an upsert only. Read the document and `replaceOne` it when the update touches
  those fields.
- **Expecting `$inc` to respect a `.min()` or `.max()`**: the checks of a field apply to its value,
  which an update does not know, so `$inc: { views: -5 }` passes `.min(0)`. Guard it in the filter,
  such as `{ views: { $gte: 5 } }`.
- **An upsert whose update lacks a required field**: it throws a `ZodError`, also when a document
  matches. Give the field in the filter or with `$setOnInsert`.
- **Catching every error as a `ZodError`**: a duplicate key is the driver's `MongoServerError`.
  Check `instanceof z.ZodError` before reading `issues`.
- **An async refinement that has to see a transaction**: it reads outside of it. Move the check to a
  plugin's `before` hook.
- **Trusting reads to fit the schema**: they are not validated. Use `sync()` with `jsonSchema`, and
  migrate old documents.
