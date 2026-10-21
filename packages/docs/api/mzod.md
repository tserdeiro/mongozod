---
title: mongozod/mzod
description: The reference of mongozod/mzod, the builders of endpoint inputs and the BSON field types of a document schema.
---

`mongozod/mzod` is the Zod of MongoDB: what Zod doesn't bring for MongoDB, in one namespace. Import
it as a namespace, like Zod, so a bundler that tree-shakes keeps only what you use:

```ts
import { ObjectId, UUID } from 'bson'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const userSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  name: z.string(),

  email: z.email()
})

const postSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  title: z.string()
    .min(1),

  body: z.string()
    .default(''),

  status: z.enum(['draft', 'published'])
    .default('draft'),

  tags: mz.set(z.string())
    .default([]),

  authorId: mz.objectId(),

  views: z.number()
    .int()
    .default(0),

  pinnedAt: mz.date()
    .optional(),

  createdAt: mz.date(),

  updatedAt: mz.date()
})

export const listPostsInput = z.object({

  filter: mz
    .filter(postSchema, {
      status: ['$eq'],
      tags: ['$eq', '$in']
    })
    .default({}),

  after: mz.after(postSchema, { createdAt: -1, _id: -1 }),

  populate: mz.populate({
    authorId: userSchema.pick({ _id: true, name: true })
  }),

  limit: z.number()
    .int()
    .min(1)
    .max(100)
    .default(20)
})
```

It has two groups of exports:

- **[Builders](#builders)**: `filter`, `update`, `sort`, `projection`, `after`, `populate` and
  `term` build Zod schemas that accept MongoDB syntax from a client, limited to what the endpoint
  declares. [`from`](#mzfrom) binds the ones that take a schema to it.
- **[Field types](#field-types)**: `objectId`, `decimal128`, `binary`, `uuid`, `date`, `set` and the
  [GeoJSON](#geojson) geometries go in a document schema. They take what a JSON client sends and
  return the BSON value.

`mongozod/mzod` never imports the driver, so the schemas that use it also run in browsers and React
Native. The examples on this page reuse `userSchema` and `postSchema` above.

## Builders

Each builder takes a declaration, and the schema of the document for all of them but
`mz.populate`, and returns a Zod schema to nest in the input of an endpoint. A missing `after` is
the first page, a missing projection is the mask, and a missing sort or populate is `undefined`; a
missing filter is up to each endpoint. A
wrong declaration doesn't compile and throws an `Error` prefixed with the builder's name, and a
wrong input fails with Zod's `ZodError`. See [Endpoint inputs](../guides/endpoint-inputs.md), and
[Defaults and required fields](../guides/endpoint-inputs.md#defaults-and-required-fields) for what a
missing input means.

### mz.from()

`mz.from(schema)` binds the builders that take a schema to one, so the inputs of a module name it
once: `after`, `filter`, `projection`, `sort`, `term` and `update`, each with what it takes after
the schema, and the same checks, suggestions and result. It loads the six, so a client bundle that
uses it keeps all of them.

```ts
const posts = mz.from(postSchema)

const postsListInput = z.object({

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
          createdAt: true
        })
        .default({ createdAt: -1 })
    })
    .prefault({})
})
```

### mz.filter()

`mz.filter(schema, fields)` builds the filter a client can send, with the operators each path
declares. It returns a strict `z.object` with each path optional. See
[`mz.filter`](../guides/endpoint-inputs.md#mzfilter).

```ts
const postsFilter = mz.filter(postSchema, {
  _id: ['$eq', '$in'],
  status: ['$eq'],
  tags: ['$eq', '$all'],
  title: ['$regex'],
  createdAt: ['$gte', '$lt']
})

postsFilter.parse({ status: 'published', createdAt: { $gte: '2026-10-01T00:00:00Z' } })
// { status: 'published', createdAt: { $gte: new Date('2026-10-01T00:00:00Z') } }
```

| Operator                     | Applies to                                                               | The client sends                                                   |
| ---------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `$eq`, `$ne`                 | any field                                                                | a value of the field or, on an array, one element                  |
| `$in`, `$nin`                | any field                                                                | an array of those                                                  |
| `$gt`, `$gte`, `$lt`, `$lte` | values but booleans and objects, such as numbers, strings, dates and ids | a value of the field or, on an array, one element                  |
| `$exists`                    | any field                                                                | a boolean                                                          |
| `$regex`                     | strings                                                                  | a string, and `$options` with the flags `i`, `m`, `x`, `s` and `u` |
| `$all`                       | arrays                                                                   | an array of elements                                               |
| `$size`                      | arrays                                                                   | a non-negative integer                                             |
| `$elemMatch`                 | arrays, with declarations for their element                              | a condition on one element, with what is declared for the elements |

A path that declares no operator, `[]`, takes the value only, or one element on an array: the
client sends `{ _id: '…' }` and never `{ _id: { $eq: '…' } }`, and its type is the field's.

- **Errors when declared**: `"<path>" is not a path of the document`,
  `"<operator>" is not an operator of mz.filter`,
  `"$size" only applies to arrays, and "<path>" is not one` (also for `$all` and `$elemMatch`), and
  `"$elemMatch" on "<path>" needs operators for its elements, or paths declared under it`.
- **Errors when parsed**: `takes at least one operator` for `{}`, `"$options" needs "$regex"`,
  `"$options" takes the flags i, m, x, s and u`, Zod's `Unrecognized key` for what isn't declared,
  and
  `a value cannot have keys that start with "$", which MongoDB reads as operators`, also on fields
  that take any object, such as `z.record()` or `z.unknown()`, and also when a transform of the
  field builds such an object out of what the client sent, and
  `a value cannot be a regular expression, which MongoDB matches as a pattern: declare "$regex"`,
  for a `RegExp` that a transport such as superjson sends or a transform builds.

`$and`, `$or` and `$nor` are added with `.extend()`: see
[`$and`, `$or` and `$nor`](../guides/endpoint-inputs.md#and-or-and-nor).

### mz.update()

`mz.update(schema, operators)` builds the update a client can send, with `$set`, `$unset` and
`$inc` on the paths each one declares, outside arrays. See
[`mz.update`](../guides/endpoint-inputs.md#mzupdate).

```ts
const postsUpdate = mz.update(postSchema, {
  $set: ['title', 'body', 'status'],
  $unset: ['pinnedAt'],
  $inc: ['views']
})

postsUpdate.parse({ $set: { title: 'Hello again' }, $inc: { views: 1 } })
// { $set: { title: 'Hello again' }, $inc: { views: 1 } }
```

- **Errors when declared**: `"<path>" is not a path of the document`,
  `"<path>" is required, so it cannot be unset`, `"<path>" is not a number`,
  `"<operator>" is not an operator of mz.update: use $set, $unset or $inc`,
  `the _id is immutable`, `"<path>" goes through an array: mz.update takes paths outside arrays` and
  `"<path>" names an element of an array: mz.update takes paths outside arrays`.
- **Errors when parsed**: `an update takes at least one operator` for `{}`, Zod's
  `Unrecognized key` for an operator or a path not declared, and
  `"<key>" cannot be a key: no path reaches a key with a "." or starting with "$"` for a key of a
  value of `$set`, at any level, such as one of a `z.record()` or a `z.unknown()`: the model
  rejects it when it writes, so the builder rejects it first.

At runtime, `$unset` also takes a key that a record or a catchall may lack, such as
`'labels.home'`, but the types don't take it yet.

### mz.sort()

`mz.sort(schema, mask)` builds the sort a client can send, with `1` or `-1` on the paths the mask
declares, in the order the client sends them. It is optional: a missing sort is `undefined`, the
natural order, unless you give a default with `.default()`. See
[`mz.sort`](../guides/endpoint-inputs.md#mzsort).

```ts
const postsSort = mz
  .sort(postSchema, {
    createdAt: true,
    title: true
  })
  .default({ createdAt: -1 })

postsSort.parse({ title: 1, createdAt: -1 })
// { title: 1, createdAt: -1 }
```

- **Types**: its input and its output are the declared paths with `1` or `-1`, so a typed client,
  such as one of tRPC, knows what each list sorts by.
- **Errors when declared**: `"<path>" is not a path of the document`, and
  `declare at least one path` for an empty mask.

### mz.projection()

`mz.projection(schema, mask)` builds the projection a client can send, with `1`, `0`, `true` or
`false` on the paths the mask declares, and returns an inclusion of declared paths: an exclusion
means the declared paths but those, and `{}` or no projection means all of them. See
[`mz.projection`](../guides/endpoint-inputs.md#mzprojection).

```ts
const postsProjection = mz.projection(postSchema, {
  title: true,
  body: true,
  tags: true
})

postsProjection.parse({ title: 1, tags: true })
// { title: 1, tags: 1 }
postsProjection.parse({ body: 0 })
// { title: 1, tags: 1 }
postsProjection.parse(undefined)
// { title: 1, body: 1, tags: 1 }
```

- **Errors when declared**: `"<path>" is not a path of the document`,
  `"<path>" and "<path inside it>" overlap, which MongoDB rejects in one projection: declare one of them`,
  and `declare at least one path` for an empty mask.
- **Errors when parsed**: `a projection cannot mix inclusion and exclusion, except for _id`, and
  `a projection cannot exclude every path the endpoint offers` when it also excludes the `_id`.

### mz.after()

`mz.after(schema, sort)` builds the filter of the page after a document, for keyset pagination: the
client sends the sort values of the last document, and the router gets an `{ $or: [...] }`. A
missing one is `{}`, the first page. See [Pagination](../guides/pagination.md).

```ts
const postsAfter = mz.after(postSchema, { createdAt: -1, _id: -1 })

postsAfter.parse({ createdAt: '2026-10-05T10:00:00Z', _id: '65c3b9b4f1d2a34b5c6d7e8f' })
// { $or: [
//   { createdAt: { $lt: new Date('2026-10-05T10:00:00Z') } },
//   { createdAt: new Date('2026-10-05T10:00:00Z'), _id: { $lt: ObjectId('65c3…') } }
// ] }
postsAfter.parse(undefined)
// {}
```

- **Errors when declared**: `the sort ends with _id, which breaks ties`,
  `"<key>" sorts with 1 or -1`, `"<key>" is an array: mz.after sorts by fields of one value`,
  `"<key>" can be missing or null: mz.after sorts by required fields`,
  `"<key>" is not a path of the document`,
  `"<key>" goes through an array: mz.after takes paths outside arrays` and
  `"<key>" names an element of an array: mz.after takes paths outside arrays`. The types ask for
  `_id` but can't see the order of the keys: only the runtime checks that `_id` comes last.

### mz.populate()

`mz.populate(whitelists)` builds the `populate` a client can send: the references it can expand,
each with a `z.object` of the fields it can see, the ones of its first level: a field that is an
object comes whole. It is optional: a missing one is `undefined`, which expands nothing. See
[`mz.populate`](../guides/endpoint-inputs.md#mzpopulate) and [Populate](../guides/populate.md).

```ts
const postsPopulate = mz.populate({
  authorId: userSchema.pick({ _id: true, name: true })
})

postsPopulate.parse({ authorId: true })
// { authorId: { projection: { _id: 1, name: 1 } } }

postsPopulate.parse({ authorId: { name: 1 } })
// { authorId: { projection: { name: 1 } } }
```

- **Errors when declared**: `"<reference>" declares no fields: pick at least one`, since MongoDB
  reads an empty projection as the whole document.
- **Errors when parsed**: `takes true, or an object with 1 or true for some of its fields` for `{}`
  and an exclusion, and Zod's `Unrecognized key` for a field outside the whitelist or a reference
  not declared.

### mz.term()

`mz.term(schema, mask)` builds the search term a client can send, as in a search box: the router
gets a filter in which each word of the term appears in one of the paths the mask declares, as part
of a word, without telling case or accents apart. It builds a `$regex` per word and path from the
escaped text, and gives `{}` for an empty or missing term. See [Search](../recipes/search.md).

```ts
const postsTerm = z.string()
  .max(100)
  .optional()
  .pipe(mz.term(postSchema, { title: true, tags: true }))

postsTerm.parse('cafe')
// { $and: [{ $or: [{ title: { $regex: 'c…[aàáâãä…]f[eèéêë…]', $options: 'i' } }, { tags: … }] }] }
```

- **Paths**: the ones that hold strings or arrays of strings. The editor suggests only those.
- **Errors when declared**: `"<path>" is not a path of the document`, `declare at least one path`,
  and in the types `"<path>" does not hold strings, which a term searches`.

## Field types

Field types go in the schema of a document. Each takes what a JSON client sends, returns the value
MongoDB stores, and gives its BSON type to the `$jsonSchema` that [`sync()`](../guides/sync.md)
applies. `z.encode` turns the value back into JSON. See [BSON types](../guides/bson-types.md).

### mz.objectId()

`mz.objectId()` takes an `ObjectId` or its 24-character hex string, and returns an `ObjectId`. See
[ObjectId](../guides/bson-types.md#objectid).

```ts
const commentSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  postId: mz.objectId()
})
```

- **Error**: `Invalid ObjectId: expected an ObjectId or its 24-character hex string`.

### mz.decimal128()

`mz.decimal128()` takes a `Decimal128`, its string, its JSON or an exact number, and returns a
`Decimal128`, the BSON type for money. See [Decimal128](../guides/bson-types.md#decimal128).

```ts
const invoiceSchema = z.object({

  total: mz.decimal128()
})

invoiceSchema.parse({ total: '10.50' }).total.toString()
// '10.50'
```

- **Errors**: `Invalid Decimal128: expected a Decimal128, its string such as "10.50", or a number`,
  and `has more than 15 significant digits, which a number cannot keep: send it as a string`.

### mz.binary()

`mz.binary()` takes the base64 string of the bytes, a `Uint8Array`, a `Buffer` or a `Binary`, and
returns a `Binary`. See [Binary data](../guides/bson-types.md#binary-data).

```ts
const attachmentSchema = z.object({

  name: z.string(),

  data: mz.binary()
})
```

- **Error**: `Invalid binary: expected a Binary, a Uint8Array or the base64 string of its bytes`.

### mz.uuid()

`mz.uuid()` takes the string of a UUID, with hyphens, a `UUID` or a `Binary` of subtype 4, and
returns a `UUID`, stored as a `Binary` of subtype 4. See [UUID](../guides/bson-types.md#uuid).

```ts
const sessionSchema = z.object({

  _id: mz.uuid()
    .default(() => new UUID()),

  userId: mz.objectId()
})
```

- **Error**: `Invalid UUID: expected a UUID or its string`.

### mz.date()

`mz.date()` takes a `Date` or an ISO datetime string with `Z` or an offset, and returns a `Date`.
It imports only Zod. See [Dates](../guides/bson-types.md#dates).

```ts
const eventSchema = z.object({

  startsAt: mz.date(),

  endsAt: mz.date()
    .optional()
})
```

- **Error**: `Invalid date: expected a Date or an ISO datetime string with Z or an offset`.

### mz.set()

`mz.set(item)` is an array that keeps each value once, like `$addToSet`, with each element parsed
by `item`. It returns an array, not a `Set`. See [Sets](../guides/bson-types.md#sets).

```ts
const tagsSchema = mz.set(z.string())

tagsSchema.safeParse(['mongodb', 'zod', 'mongodb']).success
// false: "is repeated: a set keeps each value once", at index 2
```

- **Error**: `is repeated: a set keeps each value once`, at the index of the repeated value.

## GeoJSON

The GeoJSON geometries are Zod schemas of the
[GeoJSON objects](https://www.mongodb.com/docs/manual/reference/geojson/) MongoDB stores and
queries. Input and output are the same, and they import only Zod. See
[GeoJSON](../guides/bson-types.md#geojson).

```ts
const storeSchema = z.object({

  name: z.string(),

  location: mz.point(),

  deliveryArea: mz.polygon()
    .optional()
})

storeSchema.parse({ name: 'Centro', location: { type: 'Point', coordinates: [-58.38, -34.6] } })
```

They check what MongoDB rejects with a `2dsphere` index:

- **A position** is `[longitude, latitude]`, with an optional altitude:
  `longitude goes from -180 to 180` and `latitude goes from -90 to 90`.
- **A line** has two different positions at least: `a line has 2 different positions at least`.
- **A ring** is closed and has four positions at least:
  `a ring is closed: its last position repeats the first` and
  `a ring has 4 positions at least, the last repeating the first`.

### mz.point()

`mz.point()` is a `Point`: `{ type: 'Point', coordinates: [longitude, latitude] }`.

### mz.lineString()

`mz.lineString()` is a `LineString`: `coordinates` is an array of two different positions at least.

### mz.polygon()

`mz.polygon()` is a `Polygon`: `coordinates` is its exterior ring, then its holes. An empty one
fails with `a polygon has its exterior ring`.

### mz.multiPoint()

`mz.multiPoint()` is a `MultiPoint`, with one position at least:
`a MultiPoint has 1 position at least`.

### mz.multiLineString()

`mz.multiLineString()` is a `MultiLineString`, with one line at least:
`a MultiLineString has 1 line at least`.

### mz.multiPolygon()

`mz.multiPolygon()` is a `MultiPolygon`, with one polygon at least:
`a MultiPolygon has 1 polygon at least`.

### mz.geometryCollection()

`mz.geometryCollection()` is a `GeometryCollection`: `{ type: 'GeometryCollection', geometries }`,
with one geometry at least of the types above, none of them another collection. An empty one fails
with `a GeometryCollection has 1 geometry at least`.
