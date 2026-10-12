---
title: Schemas
description: Describe a stored document with a Zod schema, from its _id and defaults to the types a model takes and returns.
---

A model's schema is a Zod object that describes a document as it is stored. mongozod validates
every write with it and types every read from it, so it is the only place where the shape of a
document lives.

```ts
import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import { z } from 'zod'

const postSchema = z.object({
  _id: mz.objectId().default(() => new ObjectId()),
  title: z.string().min(1),
  body: z.string().default(''),
  status: z.enum(['draft', 'published']).default('draft'),
  tags: z.array(z.string()).default([]),
  authorId: mz.objectId(),
  publishedAt: mz.date().optional()
})

const PostsModel = mongozod({ collection: 'posts', db, schema: postSchema })
```

The schema is a `z.object`, or a `z.discriminatedUnion` of objects for a collection that stores
several types of document (see [Document types](./document-types.md)). Its fields can be any Zod
schema whose value the driver stores and reads back, plus the field types of `mongozod/mzod`, such
as `mz.objectId()` and `mz.date()`, which take what a JSON client sends and return the BSON value
(see [BSON types](./bson-types.md)).

## The `_id`

Every MongoDB document has an `_id`. The schema decides how it is generated, in one of three forms:

| Form                    | Schema                                               | On insert                                             |
| ----------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Not declared            | No `_id` field                                       | The driver generates an `ObjectId`, as it does alone. |
| `ObjectId` with default | `_id: mz.objectId().default(() => new ObjectId())`   | The default generates it, unless the insert gives it. |
| String with default     | `_id: z.uuidv4().default(() => crypto.randomUUID())` | The default generates it, unless the insert gives it. |

There is no option to generate ids: the `.default()` in the schema is the only source. When the
schema does not declare `_id`, reads and filters still type it as an `ObjectId`.

An `_id` without a `.default()` is required on every insert. That fits an id that something else
assigns, such as the documents of another library or a natural key:

```ts
const userSchema = z.object({
  _id: z.string(),
  name: z.string(),
  email: z.email()
})

const UsersModel = mongozod({ collection: 'users', db, schema: userSchema })

// @ts-expect-error: the _id has no default, so the insert gives it
await UsersModel.insertOne({ name: 'Ana', email: 'ana@example.com' })
```

Define the `_id` once and reuse it in every schema, such as
`const objectIdKey = mz.objectId().default(() => new ObjectId())`. The `_id` of a document cannot
change: a replacement keeps it, and only `$setOnInsert` writes it in an
update (see [Validation](./validation.md)). [IDs](../recipes/ids.md) compares the forms in depth.

## Defaults

`.default()` fills a field that a write leaves out. `insertOne` returns the stored document, with
its defaults:

```ts
const { document: post } = await PostsModel.insertOne({
  title: 'Hello, MongoDB',
  authorId: new ObjectId()
})
// { _id: ObjectId('…'), title: 'Hello, MongoDB', body: '', status: 'draft', tags: [], authorId: ObjectId('…') }
```

Defaults apply wherever a write parses a value with the schema:

- inserts and replacements, at every level of the document;
- the value an update operator writes, such as an object in `$set` that leaves out a field with a
  default;
- the document an upsert would insert: mongozod adds the defaults it lacks with `$setOnInsert`, so
  the `_id` of a `.default()` reaches it too.

Reads return documents as they are stored, without parsing them. A document written before a field
got its `.default()` comes back without it, although the type of the read says it is there:
update the stored documents when you add one (see
[Schema migrations](../recipes/schema-migrations.md)).

## Input and output

Zod gives every schema two types: `z.input`, what it parses, and `z.output`, what it returns. The
database stores the output, so writes take the input and reads return the output:

```ts
const draft: z.input<typeof postSchema> = {
  title: 'Dates and ids',
  authorId: '65f1c2a4b7e8d9f0a1b2c3d4',
  publishedAt: '2026-10-12T09:00:00Z'
}

const { document: stored } = await PostsModel.insertOne(draft)
// stored.authorId is an ObjectId and stored.publishedAt a Date

const published: z.output<typeof postSchema> | null = await PostsModel.findOne({ _id: stored._id })
```

`mz.objectId()` takes an `ObjectId` or its hex string, and `mz.date()` a `Date` or an ISO string,
and both return the BSON value. The same goes for any transform or codec of a field, such as
`z.string().trim().toLowerCase()`: the document stores what Zod returns.

Zod keeps a key set to `undefined` in its output. mongozod drops it at every level before writing,
because the driver would store it as `null`. To remove a field from a stored document, use
`$unset`.

## Fields computed from others

A `.transform()` of the whole document does not run on updates, which write paths, so a model
rejects it. A field computed from others goes in `.overwrite()`, which returns the same object type:

```ts
const tagSchema = z
  .object({
    name: z.string().min(1),
    slug: z.string().default('')
  })
  .overwrite((tag) => ({ ...tag, slug: tag.name.toLowerCase().replaceAll(' ', '-') }))

const TagsModel = mongozod({ collection: 'tags', db, schema: tagSchema })

const { document: tag } = await TagsModel.insertOne({ name: 'Schema Design' })
// { _id: ObjectId('…'), name: 'Schema Design', slug: 'schema-design' }
```

`.overwrite()` cannot add a field to the type, so the schema declares `slug`. Its `.default('')`
lets inserts leave it out while reads type it as a `string`.

`.overwrite()` runs where the whole document is parsed: inserts, replacements and the document an
upsert would insert. An update writes paths, so it does not run there: an update that changes
`name` has to set `slug` too.

```ts
await TagsModel.updateOne(
  { _id: tag._id },
  { $set: { name: 'Data Modeling', slug: 'data-modeling' } }
)
```

See [Transforms](../recipes/transforms.md) for transforms that are not idempotent, such as a hash.

## Zod Mini

A schema of Zod Mini works the same:

```ts separate
import { mongozod } from 'mongozod'
import * as z from 'zod/mini'

const userSchema = z.object({
  _id: z.string(),
  name: z.string().check(z.minLength(1)),
  email: z.email()
})

const UsersModel = mongozod({ collection: 'users', db, schema: userSchema })
```

A failed write still throws the `ZodError` of `zod`, so `error instanceof ZodError` catches it with
both: mongozod parses with Zod Classic, which takes Mini schemas, because the parse of
`zod/v4/core` throws a `$ZodError`, which is not an instance of `ZodError`.

The schemas that mongozod builds, such as those of `mongozod/mzod`, are Zod Classic, and building
the first one registers Zod's English locale as the global default when the project set none: from
then on, the messages of Mini schemas are the longer English ones, such as
`Invalid input: expected string, received number`.

## What a model rejects

Some schemas would store documents that no read gives back, or that no path reaches. `mongozod()`
throws an `Error` for them when the model is defined:

- **A root that is not a document**: a `.transform()` of the whole object, an `.optional()` or a
  `z.intersection`, which do not compile either. Combine objects with `.extend()`, and compute
  fields with `.overwrite()`.
- **`z.set()` and `z.map()`**, anywhere in the document, also as `z.instanceof(Set)` or
  `z.instanceof(Map)`: the driver stores a `Set` as `{}` and a `Map` as an object, and neither comes
  back. Use [`mz.set()`](./bson-types.md), an array without repeats, or `z.record()`.
- **A field name with a `.` or starting with `$`**, which no path reaches. The keys of a
  `z.record()`, a catchall, a `z.looseObject()`, a `z.unknown()` or a `z.json()` are checked on
  each write instead, with a `ZodError`.

A `z.bigint()` needs a `Db` or a client with `useBigInt64: true`. Without it, the driver reads a
long as a `number`, so every operation of the model throws an `Error` that names the field:

```ts
const statsSchema = z.object({ postId: mz.objectId(), views: z.bigint() })

const PostStatsModel = mongozod({
  collection: 'post_stats',
  db: client.db('blog', { useBigInt64: true }),
  schema: statsSchema
})
```

Recursive schemas, with the getters that Zod 4 recommends, are accepted (see
[Schema patterns](../recipes/schema-patterns.md)).

## Common mistakes

- **Expecting a read to fill a default**: a document stored before the field had a `.default()`
  comes back without it, though its type says otherwise. Update the stored documents when you add
  the default.
- **A `.transform()` on the whole schema**: `mongozod()` throws an `Error`. Use `.overwrite()`, and
  set the computed field in each update that changes what it is computed from.
- **`z.date()` in a schema that receives JSON**: it rejects the ISO string a client sends. Use
  `mz.date()`, which takes both and stores a `Date`.
- **An `_id` without `.default()` by accident**: every insert needs it, and it does not compile
  without it. Add the `.default()`, or leave `_id` out to let the driver generate an `ObjectId`.
- **Setting a field to `undefined` to remove it**: mongozod drops the key, and the stored value
  stays. Use `$unset`, which works on optional fields.
- **`z.set()` for a list without repeats**: `mongozod()` throws an `Error`. Use `mz.set()`.
