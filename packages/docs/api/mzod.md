---
title: mongozod/mzod
description: The reference of mongozod/mzod, the builders of endpoint inputs and the BSON field types of a document schema.
---

`mongozod/mzod` is the Zod of MongoDB: what Zod doesn't bring for MongoDB, in one namespace. Import
it as a namespace, like Zod, so a bundler keeps only what you use:

```ts
import { ObjectId, UUID } from 'bson'
import * as mz from 'mongozod/mzod'
import { z } from 'zod'

const userSchema = z.object({
  _id: mz.objectId().default(() => new ObjectId()),
  name: z.string(),
  email: z.email()
})

const postSchema = z.object({
  _id: mz.objectId().default(() => new ObjectId()),
  title: z.string().min(1),
  body: z.string().default(''),
  status: z.enum(['draft', 'published']).default('draft'),
  tags: mz.set(z.string()).default([]),
  authorId: mz.objectId(),
  views: z.number().int().default(0),
  pinnedAt: mz.date().optional(),
  createdAt: mz.date(),
  updatedAt: mz.date()
})

export const listPostsInput = z.object({
  filter: mz.filter(postSchema, { status: ['$eq'], tags: ['$eq', '$in'] }).default({}),
  after: mz.after(postSchema, { createdAt: -1, _id: -1 }).default({}),
  populate: mz.populate({ authorId: userSchema.pick({ _id: true, name: true }) }).optional(),
  limit: z.number().int().min(1).max(100).default(20)
})
```

It has two groups of exports:

- **[Builders](#builders)**: `filter`, `update`, `sort`, `projection`, `after` and `populate` build
  Zod schemas that accept MongoDB syntax from a client, limited to what the endpoint declares.
- **[Field types](#field-types)**: `objectId`, `decimal128`, `binary`, `uuid`, `date`, `set` and the
  [GeoJSON](#geojson) geometries go in a document schema. They take what a JSON client sends and
  return the BSON value.

`mongozod/mzod` never imports the driver, so the schemas that use it also run in browsers and React
Native. It imports `zod` and `bson`, a peer dependency, which a bundler leaves out unless a field
needs it. The examples on this page reuse `userSchema` and `postSchema` above.

## Builders

Each builder takes a declaration, and the schema of the document for all of them but
`mz.populate`, and returns a Zod schema to nest in the input of an endpoint. See
[Endpoint inputs](../guides/endpoint-inputs.md) for the guide.

- **Schemas**: they take Zod and Zod Mini schemas, and a `z.discriminatedUnion` at the root, whose
  fields they look up in each of its types. They build Zod Classic schemas.
- **Values**: each value is parsed with the schema of its field, without its `.default()`. An ISO
  string becomes a `Date`, and a filter never gets a fresh `_id` from a default.
- **`undefined` keys** are dropped, so a request means the same in JSON and in superjson.
- **No defaults**: the schema they return has none. Decide with Zod what a missing input means:
  `.default({})`, `.optional()`, `.required({ _id: true })` or `.refine()`.
- **Input and output**: `z.input` of the result is what the client sends, such as an ISO string,
  and `z.output` is what the router passes to the model, such as a `Date`.
- **Wrong declarations**: a path that doesn't exist, or an operator that doesn't apply to its field,
  doesn't compile and throws an `Error` that names the builder, such as
  `mz.filter: "titel" is not a path of the document`.
- **Wrong input**: what a client sends outside the declaration fails with Zod's `ZodError` when you
  parse it, like any other schema.

### mz.filter()

`mz.filter(schema, fields)` builds the filter a client can send, with the operators each field
declares.

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

- **`schema`**: the document schema. `_id` is a path only when the schema declares it.
- **`fields`**: an object whose keys are paths of the document, dotted paths included, and whose
  values are lists of operators. The editor suggests the paths and, for each one, the operators
  that apply to it:

  | Operator                     | Applies to                                                               | The client sends                                                   |
  | ---------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
  | `$eq`, `$ne`                 | any field                                                                | a value of the field or, on an array, one element                  |
  | `$in`, `$nin`                | any field                                                                | an array of those                                                  |
  | `$gt`, `$gte`, `$lt`, `$lte` | values but booleans and objects, such as numbers, strings, dates and ids | a value of the field or, on an array, one element                  |
  | `$exists`                    | any field                                                                | a boolean                                                          |
  | `$regex`                     | strings                                                                  | a string, and `$options` as a string                               |
  | `$all`                       | arrays                                                                   | an array of elements                                               |
  | `$size`                      | arrays                                                                   | a non-negative integer                                             |
  | `$elemMatch`                 | arrays, with declarations for their element                              | a condition on one element, with what is declared for the elements |

- **Accepts**: for each declared path, the value alone when it declares `$eq`, or an object of its
  operators, with one at least. `$options` only goes with `$regex`, as MongoDB requires. On an
  array of objects, `$elemMatch` takes the paths declared under the array, relative to the element:
  `items: ['$elemMatch']` with `'items.status': ['$eq']`. On an array of values, it takes the
  operators the field declares for one element, such as `scores: ['$gte', '$lt', '$elemMatch']`.
  Anything else fails, such as `$where`, `$expr`, a field or an operator not declared, or a value
  its field doesn't take.
- **Returns**: a strict `z.object` with each declared path optional. `.required()`, `.refine()`,
  `.default()` and `.extend()` work on it; `.pick()`, `.omit()` and `.partial()` throw, so declare
  another filter with another `mz.filter`.
- **Errors when declared**, prefixed with `mz.filter:`: `"<path>" is not a path of the document`,
  `"<operator>" is not an operator of mz.filter`,
  `"$size" only applies to arrays, and "<path>" is not one` (also for `$all` and `$elemMatch`), and
  `"$elemMatch" on "<path>" needs operators for its elements, or paths declared under it`. A
  `$regex` on a field that isn't a string, or a range on a boolean, only fails to compile: at
  runtime the value is still parsed with the schema of its field.
- **Errors when parsed**: `takes at least one operator` for `{}`, `"$options" needs "$regex"`, and
  Zod's `Unrecognized key` for what isn't declared.

`$and`, `$or` and `$nor` aren't accepted unless the endpoint adds them with `.extend()`, with the
same allow list at each level:

```ts
const audienceFilter = mz.filter(postSchema, { status: ['$eq'], tags: ['$in'] }).extend({
  get $or() {
    return z.array(audienceFilter).optional()
  }
})
```

### mz.update()

`mz.update(schema, operators)` builds the update a client can send, with `$set`, `$unset` and
`$inc` on the paths each one declares.

```ts
const postsUpdate = mz.update(postSchema, {
  $set: ['title', 'body', 'status'],
  $unset: ['pinnedAt'],
  $inc: ['views']
})

postsUpdate.parse({ $set: { title: 'Hello again' }, $inc: { views: 1 } })
// { $set: { title: 'Hello again' }, $inc: { views: 1 } }
```

- **`schema`**: the document schema.
- **`operators`**: an object with `$set`, `$unset` or `$inc`, each with a list of paths outside
  arrays: no path through an array, no index and no positional operator, which the router builds.
  `$unset` takes optional fields only, and a field with a `.default()` isn't one. `$inc` takes
  numbers and `mz.decimal128()` fields. The `_id` is never declared. Don't declare the fields of
  `timestamps` either: the model sets them, and its update rejects them.
- **Accepts**: under `$set`, the input of each field, parsed with its schema, refinements
  included. Under `$unset`, `''`, `1` or `true`. Under `$inc`, a number, an integer when the field
  is one, or for a `Decimal128` what its schema parses without its checks, such as `'0.10'`. A
  default is never filled in, so an update of one field doesn't reset the others. `{ $set: {} }`
  passes, as MongoDB accepts it.
- **Returns**: a Zod schema whose output the router passes to the model, which validates it again
  when it writes.
- **Errors when declared**, prefixed with `mz.update:`: `"<path>" is not a path of the document`,
  `"<path>" is required, so it cannot be unset`, `"<path>" is not a number`,
  `"<operator>" is not an operator of mz.update: use $set, $unset or $inc`,
  `the _id is immutable`, `"<path>" goes through an array: mz.update takes paths outside arrays` and
  `"<path>" names an element of an array: mz.update takes paths outside arrays`.
- **Errors when parsed**: `an update takes at least one operator` for `{}`, and Zod's
  `Unrecognized key` for an operator or a path not declared.

At runtime, `$unset` also takes a key that a record or a catchall may lack, such as
`'labels.home'`, but the types don't take it yet.

### mz.sort()

`mz.sort(schema, mask)` builds the sort a client can send, over the paths it declares.

```ts
const postsSort = mz.sort(postSchema, { createdAt: true, title: true }).default({ createdAt: -1 })

postsSort.parse({ title: 1, createdAt: -1 })
// { title: 1, createdAt: -1 }
```

- **`mask`**: the paths the client can sort by, each with `true`, like Zod's `.pick()`.
- **Accepts**: an object of declared paths with `1` or `-1`. It keeps the order of the keys as the
  client sends them, which decides what sorts first. `'asc'`, `{ $meta: 'textScore' }` and paths
  not declared fail.
- **Returns**: a Zod schema whose input and output are `{ [path]?: 1 | -1 }`.
- **Errors when declared**, prefixed with `mz.sort:`: `"<path>" is not a path of the document`, and
  `declare at least one path` for an empty mask.

### mz.projection()

`mz.projection(schema, mask)` builds the projection a client can send, over the paths it declares.

```ts
const postsProjection = mz.projection(postSchema, { title: true, body: true, tags: true })

postsProjection.parse({ title: 1, tags: true })
// { title: 1, tags: true }
```

- **`mask`**: the paths the client can ask for, each with `true`. A virtual is declared as a field,
  with a schema that adds it, such as `userSchema.extend({ displayName: z.string() })`.
- **Accepts**: `1` or `true` to include and `0` or `false` to exclude, without mixing both except
  for `_id`: `a projection cannot mix inclusion and exclusion, except for _id`. Operators such as
  `$slice` fail.
- **Returns**: a Zod schema whose input and output are `{ [path]?: 0 | 1 | boolean }`. The model
  doesn't know whether a projection that arrives at runtime includes or excludes, so its read leaves
  each field optional.
- **Errors when declared**, prefixed with `mz.projection:`:
  `"<path>" is not a path of the document`, and `declare at least one path` for an empty mask.

### mz.after()

`mz.after(schema, sort)` builds the filter of the page after a document, for keyset pagination: the
client sends the sort values of the last document of a page, and the router gets the filter of the
next one.

```ts
const postsAfter = mz.after(postSchema, { createdAt: -1, _id: -1 })

postsAfter.parse({ createdAt: '2026-10-05T10:00:00Z', _id: '65c3b9b4f1d2a34b5c6d7e8f' })
// { $or: [
//   { createdAt: { $lt: new Date('2026-10-05T10:00:00Z') } },
//   { createdAt: new Date('2026-10-05T10:00:00Z'), _id: { $lt: ObjectId('65c3…') } }
// ] }
```

- **`sort`**: the sort of the list, with `1` or `-1`, ending with `_id`, which breaks ties. Its
  fields are required, hold one value and are outside arrays (see
  [The sort](../guides/pagination.md#the-sort) for why). The router sorts the list the same way.
- **Accepts**: an object with every field of the sort, each parsed with its schema, such as an ISO
  string for a date and a hex string for an `ObjectId`.
- **Returns**: a Zod schema whose output is `{ $or: [...] }`, the filter to combine with the
  others in a `$and`. The first page sends nothing: give it `.default({})`.
- **Errors when declared**, prefixed with `mz.after:`: `the sort ends with _id, which breaks ties`,
  `"<key>" sorts with 1 or -1`, `"<key>" is an array: mz.after sorts by fields of one value`,
  `"<key>" can be missing or null: mz.after sorts by required fields`,
  `"<key>" is not a path of the document`,
  `"<key>" goes through an array: mz.after takes paths outside arrays` and
  `"<key>" names an element of an array: mz.after takes paths outside arrays`. The types ask for
  `_id` but can't see the order of the keys: only the runtime checks that `_id` comes last.

See [Pagination](../guides/pagination.md) for the guide.

### mz.populate()

`mz.populate(whitelists)` builds the `populate` a client can send: the references it can expand,
and the fields it can see of each one.

```ts
const postsPopulate = mz.populate({ authorId: userSchema.pick({ _id: true, name: true }) })

postsPopulate.parse({ authorId: true })
// { authorId: { projection: { _id: 1, name: 1 } } }

postsPopulate.parse({ authorId: { name: 1 } })
// { authorId: { projection: { name: 1 } } }
```

- **`whitelists`**: an object whose keys are references of the model and whose values are
  `z.object` schemas with the fields a client can see, usually a `.pick()` of the referenced
  schema. A virtual is declared as a field, with a schema that adds it. It takes no document
  schema: the model's types check each key when the router passes the result to a read.
- **Accepts**: for each reference, `true` for every field of its whitelist, or an object with `1`
  or `true` for some of them. `{}` and an exclusion fail with
  `takes true, or an object with 1 or true for some of its fields`, and a field outside the
  whitelist or a reference not declared with Zod's `Unrecognized key`. The client never sends
  `filter` or `sort`: those are the endpoint's.
- **Returns**: a Zod schema whose output is the model's `populate`, with a `projection` of the
  fields asked for. In the type of the read, each reference may still be its id, and each field of
  the populated document is optional, because the model can't know at compile time what the
  client asked for.

See [Populate](../guides/populate.md) for references and `populate` on the model.

## Field types

Field types go in the schema of a document. Each takes what a JSON client sends, returns the value
MongoDB stores, and gives its BSON type to the `$jsonSchema` that [`sync()`](../guides/sync.md)
applies. `z.encode` turns the value back into JSON. None takes arguments but `mz.set()`.

A value that `objectId`, `decimal128`, `binary`, `uuid` or `date` rejects gives one issue that says
what the field takes, which adds `, received undefined` when the field is missing, as Zod says it.
See [BSON types](../guides/bson-types.md) for the guide.

### mz.objectId()

`mz.objectId()` is an `ObjectId` field.

```ts
const commentSchema = z.object({
  _id: mz.objectId().default(() => new ObjectId()),
  postId: mz.objectId()
})
```

- **Accepts**: an `ObjectId`, or its 24-character hex string, in either case.
- **Returns**: an `ObjectId`. `z.encode` gives the hex string. `$jsonSchema`: `objectId`.
- **Error**: `Invalid ObjectId: expected an ObjectId or its 24-character hex string`.

It takes an `ObjectId` of either build of `bson`. Compare two with `.equals()`, not with
`instanceof`: see [BSON types](../guides/bson-types.md#objectid).

### mz.decimal128()

`mz.decimal128()` is a `Decimal128` field, the BSON type for money.

```ts
const invoiceSchema = z.object({ total: mz.decimal128() })

invoiceSchema.parse({ total: '10.50' }).total.toString()
// '10.50'
```

- **Accepts**: a `Decimal128`, its string such as `'10.50'`, its JSON such as
  `{ $numberDecimal: '10.50' }`, or a number that is the decimal it was written as: 15
  significant digits at most, or a safe integer.
- **Returns**: a `Decimal128`. `z.encode` gives the string. `$jsonSchema`: `decimal`.
- **Errors**: `Invalid Decimal128: expected a Decimal128, its string such as "10.50", or a number`,
  also for `NaN` and `Infinity` in any form and a string that `bson` would round, with more than 34
  digits. A number with more digits, such as the `0.30000000000000004` of `0.1 + 0.2`, fails with
  `has more than 15 significant digits, which a number cannot keep: send it as a string`.

`$inc` and `$mul` parse their amount without the field's checks, and a filter on a decimal takes a
`Decimal128`: see [BSON types](../guides/bson-types.md#decimal128).

### mz.binary()

`mz.binary()` is a binary field.

```ts
const attachmentSchema = z.object({ name: z.string(), data: mz.binary() })
```

- **Accepts**: the base64 string of the bytes, a `Uint8Array` or a `Buffer`, or a `Binary`.
- **Returns**: a `Binary`, the type the driver reads binary data as. A `Binary` passes as it is,
  with its subtype; the others become subtype 0, as the driver stores bytes. `z.encode` gives the
  base64 string. `$jsonSchema`: `binData`.
- **Error**: `Invalid binary: expected a Binary, a Uint8Array or the base64 string of its bytes`.

### mz.uuid()

`mz.uuid()` is a UUID field, stored as a `Binary` of subtype 4: 16 bytes, where its string takes 36.

```ts
const sessionSchema = z.object({ _id: mz.uuid().default(() => new UUID()), userId: mz.objectId() })
```

- **Accepts**: the string of a UUID, with hyphens, in either case, a `UUID`, or a `Binary` of
  subtype 4.
- **Returns**: a `UUID`, the type the driver reads subtype 4 as. `z.encode` and `JSON.stringify`
  give the string. `$jsonSchema`: `binData`.
- **Error**: `Invalid UUID: expected a UUID or its string`, also for a string without hyphens and a
  `Binary` of another subtype.

### mz.date()

`mz.date()` is a date field, the documented type of the fields of `timestamps`.

```ts
const eventSchema = z.object({ startsAt: mz.date(), endsAt: mz.date().optional() })
```

- **Accepts**: a `Date`, or an ISO datetime string with `Z` or an offset, such as
  `'2026-10-01T07:00:00-03:00'`. One without either is rejected: it doesn't say which instant it is.
- **Returns**: a `Date`. `z.encode` gives an ISO string in UTC. `$jsonSchema`: `date`.
- **Error**: `Invalid date: expected a Date or an ISO datetime string with Z or an offset`, also for
  an invalid `Date`.

It imports only Zod, so a client that uses it doesn't load `bson`.

### mz.set()

`mz.set(item)` is a set field: an array that keeps each value once, like `$addToSet`.

```ts
const tagsSchema = mz.set(z.string())

tagsSchema.safeParse(['mongodb', 'zod', 'mongodb']).success
// false: "is repeated: a set keeps each value once", at index 2
```

- **`item`**: the schema of each element, such as `z.string()` or `mz.objectId()`.
- **Accepts**: an array whose values are all different, compared like the `uniqueItems` of
  MongoDB's `$jsonSchema`: numbers by value, BSON values such as an `ObjectId` by theirs, dates by
  their instant and objects by their fields in any order. Elements are parsed first, so a hex string
  and the `ObjectId` it decodes to are the same value.
- **Returns**: an array, the type reads return, and not the `Set` of `z.set()`, which the model
  rejects. It stays a set through `.min()`, `.optional()`, `.default()` and `.nullable()`.
  `$jsonSchema`: an `array` with `uniqueItems: true`.
- **Error**: `is repeated: a set keeps each value once`, at the index of the repeated value.

On a model, an update adds to a set only with `$addToSet`: see
[BSON types](../guides/bson-types.md#sets).

## GeoJSON

The GeoJSON geometries are Zod schemas of the
[GeoJSON objects](https://www.mongodb.com/docs/manual/reference/geojson/) MongoDB stores and
queries. They don't convert values: input and output are the same, and the `$jsonSchema`
describes them as objects and arrays. They import only Zod.

```ts
const storeSchema = z.object({
  name: z.string(),
  location: mz.point(),
  deliveryArea: mz.polygon().optional()
})

storeSchema.parse({ name: 'Centro', location: { type: 'Point', coordinates: [-58.38, -34.6] } })
```

They check what MongoDB rejects with a `2dsphere` index, which it stores as it is without one:

- **A position** is `[longitude, latitude]`, in that order, with an optional altitude:
  `longitude goes from -180 to 180` and `latitude goes from -90 to 90`.
- **A line** has two different positions at least: `a line has 2 different positions at least`.
- **A ring** is closed, with its last position repeating the first, and has four positions at
  least: `a ring is closed: its last position repeats the first` and
  `a ring has 4 positions at least, the last repeating the first`.

That a ring doesn't cross itself, or that a hole is inside the exterior ring, is left to the
`2dsphere` index.

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
with one geometry at least of the types above. An empty one fails with
`a GeometryCollection has 1 geometry at least`, and one inside another fails, as MongoDB and
RFC 7946 reject them.
