---
name: migrate-from-mongoose
description: Migrates a Mongoose model to MongoZod, one model at a time, on the connection Mongoose already opened and without changing the data MongoDB stores, from its Mongoose schema or, without one, from a $jsonSchema exported from MongoDB Compass or @mongodb-js/mongodb-schema. Use when asked to move a model, a collection or a project from Mongoose to MongoZod, or to replace Mongoose with Zod and the MongoDB driver.
---

# Migrate a Mongoose model to MongoZod

Migrate one model per run. Mongoose and MongoZod share one connection while a project migrates, so
the rest of the app keeps using Mongoose until its turn. If the user did not name the model, list
the Mongoose models of the project and ask which one.

## 1. Set up

1. Check that MongoZod is installed: `node_modules/mongozod/dist/docs/README.md` exists. In a
   monorepo, look in the package that depends on Mongoose.
2. If it is not installed, install it with the same driver as Mongoose, so that there is one copy of
   `mongodb`:
   - `npm ls mongodb` shows the version under `mongoose`. MongoZod needs driver 7 (Mongoose 9) or
     driver 6.20 (Mongoose 8.19 and later). With an older Mongoose, stop and tell the user to update
     it first.
   - Install `mongozod`, `zod`, `mongodb` at that exact version, and `bson` of the same major as the
     driver, with the project's package manager, such as
     `npm install mongozod zod mongodb@7.7.0 bson@7`.
   - Run `npm ls mongodb` again: it shows one version, `deduped` under `mongoose`.
3. Read these pages of `node_modules/mongozod/dist/docs/`: `README.md`, `mongoose/index.md`,
   `mongoose/cheatsheet.md` and `mongoose/differences.md`, then `guides/schemas.md`,
   `guides/models.md`, `guides/operations.md`, `guides/validation.md` and `guides/security.md`, and
   the guide of each
   feature the model uses, such as `guides/populate.md`, `guides/virtuals.md`,
   `guides/timestamps.md`, `guides/document-types.md`, `guides/sync.md` or `guides/plugins.md`.
   They match the installed version: follow them over what you remember of MongoZod or Mongoose.
4. Find how the project shares the connection: a function such as `mongooseDb()` that returns
   `mongoose.connection.db`. If there is none, create it as `mongoose/index.md` shows, in the module
   that connects to MongoDB.

## 2. Gather the inputs

- The Mongoose schema and model, with its middleware, methods, statics, virtuals, indexes and
  plugins.
- Every file that uses the model, including other Mongoose schemas with a `ref` to it.
- How the project protects its queries: whether it sets `sanitizeFilter` or `strictQuery`, calls
  `mongoose.trusted()`, and which call sites pass data from a request to the model.
- The name of its collection: the one the schema sets in `collection`, or the model name lowercased
  and in plural, such as `posts` for `Post`.
- Without a Mongoose schema, such as for a collection that another service writes, a `$jsonSchema`
  of its documents. Ask the user to export it from MongoDB Compass (the Schema tab, Analyze Schema,
  then Export Schema in the MongoDB format), or generate it with `@mongodb-js/mongodb-schema` as
  `mongoose/index.md` shows. It comes from a sample, so it has no defaults, enums or references, and
  any field the sample always had comes out as required: decide those from the code that writes the
  collection.

## 3. Write the Zod schema

Translate the schema with `mongoose/cheatsheet.md`. The Zod schema describes the document as MongoDB
stores it:

- Keep every field name, every shape and the collection name. Do not rename anything.
- A Mongoose path without `required` is `.optional()`. An array is `.default([])`. A required
  `String` is `.min(1)`, because Mongoose's `required` rejects `''`.
- Declare the `_id` as `mz.objectId().default(() => new ObjectId())`, and the same in each
  subdocument, unless its schema sets `_id: false`.
- Declare `__v: z.number().int().default(0)` while Mongoose still writes the collection, unless the
  Mongoose schema sets `versionKey: false`.
- With `timestamps`, declare `createdAt` and `updatedAt` as `mz.date()`, with their names.
- Use the field types of `mongozod/mzod` for BSON values: `mz.objectId()`, `mz.date()`,
  `mz.decimal128()`, `mz.binary()`, `mz.uuid()` and GeoJSON. Import it as
  `import * as mz from 'mongozod/mzod'`.

## 4. Define the model

- Call `mongozod()` with `collection`, `schema` and `db: mongooseDb`, the function, not its result.
- Translate the indexes to `indexes`, the `ref`s to `references`, the virtuals to `virtuals`, the
  `timestamps` option, and the plugins, with the cheatsheet.
- A `ref` to a collection that is still on Mongoose is a reference to `{ collection, schema }`,
  with a schema of what the reads need from it.
- A `pre('save')` that changes a field becomes a `.transform()` of that field
  (`recipes/transforms.md`). Other middleware becomes a hook of a plugin (`guides/plugins.md` and
  `plugins/writing-plugins.md`).
- Note what has no equivalent yet, as the "Not there yet" section of `mongoose/differences.md`
  lists, such as `select: false`, `immutable`, `alias` or `refPath`, and use the workaround it
  gives.

## 5. Rewrite the call sites

Rewrite each use of the Mongoose model with the cheatsheet and `mongoose/differences.md`:

- No documents and no `save()`: each change is an operation, such as `updateOne` with `$set` or
  `$push`, and reads are plain objects, without `.lean()` or `.exec()`.
- Updates take operators: `{ $set: { title } }`, not `{ title }`.
- Filters are not cast: an `_id` is an `ObjectId`, not a string. Parse a string from a request
  with `mz.objectId().parse(id)`, and a filter from a client with `mz.filter`.
- `projection`, `sort` and `populate` are objects in the options, the second argument of `find`:
  `find(filter, { projection: { title: 1 }, sort: { createdAt: -1 } })`.
- `findById(id)` is `findOne({ _id })`, and `{ new: true }` is `{ returnDocument: 'after' }`.
- A transaction passes `{ session }` to each MongoZod operation, also when Mongoose sets
  `transactionAsyncLocalStorage`.

Keep the security of each call site, with `guides/security.md` and `guides/endpoint-inputs.md`:

- MongoZod doesn't sanitize or cast filters at runtime, and a request body is typed `any`, so `tsc`
  doesn't catch a request value that reaches the model. Parse the input of each endpoint once,
  before the model: a schema from `.pick()` of the model's schema for values, `mz.filter`,
  `mz.update`, `mz.sort`, `mz.projection` or `mz.populate` for what the client sends as MongoDB
  syntax, and `mz.objectId()` for an id.
- Never pass `req.body`, `req.query` or another request object whole as a filter, an update or a
  document to insert. An insert takes `.pick()` of the fields a client may write.
- Keep every condition that scopes the documents to the user, such as an owner or a tenant, and
  join it with the client's filter with `$and`, never with a spread.
- A query that becomes an `aggregate` skips the model's plugins, such as soft delete: keep their
  conditions in its `$match`.
- For each `select: false` field, find every read of the model, `findOneAnd*` and `populate`
  included, and exclude the field there.

Keep the Mongoose model while other code calls it or another Mongoose schema has a `ref` to it.

## 6. Verify

Fix what fails, and repeat:

- The project type checks with `tsc`, with no `as` casts, `any`, `@ts-ignore` or
  `@ts-expect-error` added to make it compile: they hide the errors that point at Mongoose habits.
- The tests pass, against MongoDB.
- Write a script that reads every stored document through the model's `collection`, the driver's,
  and reports the ones that fail `schema.safeParse()`, as `mongoose/index.md` shows. Give it to the
  user to run: reads are not validated, so these documents would be read with a type they do not
  have.
- Run `sync()` only against a development or test database, and report its `extraIndexes`: the
  indexes of the collection that the model does not declare.

Never run a write, a migration or `sync()` against a production database, and do not turn on
`jsonSchema` while Mongoose still writes the collection.

## 7. Report

Tell the user:

- The files you changed, and the Mongoose model you kept or deleted.
- Each decision the Mongoose schema or the `$jsonSchema` left open, such as a field you made
  optional or an enum you inferred from the code.
- What the model used that MongoZod does not have yet, and the workaround you used.
- Each call site that takes data from a request, and how its input is parsed now.
- The script that checks the stored documents, and what `sync()` reported.
