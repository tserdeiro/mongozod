---
title: Why mongozod
description: How mongozod compares with Mongoose and with the driver and Zod by hand, the Mongoose issues it solves and when not to use it.
---

A project on MongoDB and TypeScript usually describes each document three times: in a Mongoose
schema, in a TypeScript type, and in the Zod schemas that validate what its endpoints receive. They
drift apart, and each one checks something different.

mongozod keeps one description, the Zod schema, and builds the rest from it: the model validates
every write with it, the types of every query and result come from it, and the inputs of the
endpoints are derived from it.

## Compared with Mongoose

|                   | Mongoose 9                                                                                                                                                  | mongozod                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Schema            | A Mongoose schema, apart from what validates your endpoints                                                                                                 | One Zod schema for the document, its types and the inputs of your endpoints                                          |
| Update validation | [Off by default](https://mongoosejs.com/docs/validation.html#update-validators), and only on `$set`, `$unset`, `$push`, `$addToSet`, `$pull` and `$pullAll` | Always, on every operator, with refinements, and on the document an upsert would insert                              |
| Required fields   | [Not checked by an update](https://mongoosejs.com/docs/validation.html#update-validators-only-run-on-updated-paths) unless it `$unset`s them                | An upsert fails when the document it would insert misses one                                                         |
| Filters           | [Cast at runtime](https://mongoosejs.com/docs/tutorials/query_casting.html): a value that cannot be cast throws a `CastError`                               | Typed: a value of the wrong type does not compile, and what clients send is parsed by `mz`                           |
| Results           | Documents that track changes, or plain objects with `lean()`                                                                                                | The driver's plain objects, typed by the projection and `populate`                                                   |
| Endpoint inputs   | Not covered                                                                                                                                                 | [`mongozod/mzod`](../guides/endpoint-inputs.md): MongoDB syntax from clients, limited to what each endpoint declares |
| Indexes           | [Created when the app starts](https://mongoosejs.com/docs/guide.html#indexes), unless you turn `autoIndex` off                                              | Created by [`sync()`](../guides/sync.md) when you call it                                                            |
| Driver            | Mongoose's own API on top of the driver                                                                                                                     | The driver's names, options and results, and the driver itself for everything else                                   |

Both libraries can share one connection, so a project can
[move one model at a time](../mongoose/index.md). The [cheatsheet](../mongoose/cheatsheet.md) maps
each Mongoose feature to its equivalent, and [Differences](../mongoose/differences.md) lists what
works another way.

## Compared with the driver and Zod by hand

The driver with a Zod schema already validates an insert: parse the document, then insert the
result. The rest is what a team ends up writing again in each project:

- **Updates**: an update is a set of operators on paths, not a document. mongozod validates the
  value of each path with the schema of that field, applies the rules of each operator (`$inc` on
  numbers, `$unset` on optional fields, array operators on arrays) and, for an upsert, builds and
  validates the document MongoDB would insert.
- **Types**: the driver types a filter loosely. mongozod checks every filter, update, projection and
  sort against the schema, dotted paths included, and narrows the result of a projection.
- **Relations and computed fields**: [`populate`](../guides/populate.md),
  [virtuals](../guides/virtuals.md) and [timestamps](../guides/timestamps.md), each typed in the
  reads that use it.
- **Inputs**: a client that sends a filter, a sort or a page needs an allow list per field, a
  parser for each value and a type that fits the driver. [`mz`](../guides/endpoint-inputs.md)
  builds them from the schema.
- **Cross-cutting rules**: [plugins](../guides/plugins.md) wrap every operation, like the official
  [soft delete](../plugins/soft-delete.md).

## Mongoose issues it solves

Open issues of Mongoose that mongozod handles by design:

- **Validating updates**: the required fields of an upsert
  ([#7037](https://github.com/Automattic/mongoose/issues/7037)), the subdocuments of a
  `findOneAndUpdate` ([#5234](https://github.com/Automattic/mongoose/issues/5234)) and every error
  of an update at once, not only the first
  ([#3037](https://github.com/Automattic/mongoose/issues/3037)).
- **Types**: projections with dotted paths
  ([#16575](https://github.com/Automattic/mongoose/issues/16575)) and a typed `populate`
  ([#16010](https://github.com/Automattic/mongoose/issues/16010)).
- **Queries**: a filter value outside an enum does not compile
  ([#15581](https://github.com/Automattic/mongoose/issues/15581)).
- **Discriminators**: several levels, the most upvoted open issue
  ([#2851](https://github.com/Automattic/mongoose/issues/2851), also
  [#8361](https://github.com/Automattic/mongoose/issues/8361) and
  [#9756](https://github.com/Automattic/mongoose/issues/9756)), with a `z.discriminatedUnion`
  inside another. See [Document types](../guides/document-types.md).
- **Populate**: a `limit` per document
  ([#15863](https://github.com/Automattic/mongoose/issues/15863)) and a reference stored in another
  key ([#9034](https://github.com/Automattic/mongoose/issues/9034)).
- **Field types**: GeoJSON ([#6606](https://github.com/Automattic/mongoose/issues/6606)) and arrays
  without repeated values ([#8082](https://github.com/Automattic/mongoose/issues/8082),
  [#12916](https://github.com/Automattic/mongoose/issues/12916)), with
  [`mz.set()`](../guides/bson-types.md).
- **Soft delete**, as an official plugin
  ([#7304](https://github.com/Automattic/mongoose/issues/7304)).
- **Explicit `sync()`**: indexes and collections are not created on their own
  ([#15803](https://github.com/Automattic/mongoose/issues/15803),
  [#13546](https://github.com/Automattic/mongoose/issues/13546)).

Mongoose's types have also slowed editors down
([#10349](https://github.com/Automattic/mongoose/issues/10349)). mongozod's CI fails when the type
instantiations of a typical project go over a budget, so a release cannot make your editor slower
without anyone noticing.

## When not to use it

mongozod is not the right fit, or not yet, when a project needs:

- **Documents with methods and change tracking**, like Mongoose's `doc.save()`. mongozod writes with
  explicit operations, as the driver does.
- **Filters cast at runtime** from untyped values. mongozod types them instead, and parses what
  clients send with `mz`.
- **Zod 3**, **Node.js before 22.15** or **TypeScript before 5.5**.
- Some Mongoose features that are planned but not there yet: `select: false`, `immutable` and
  `alias` on fields, optimistic concurrency with a version field, field-level encryption, and a
  plugin that keeps references consistent on delete.
