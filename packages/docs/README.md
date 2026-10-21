# mongozod documentation

<!-- Written by `pnpm --filter @repo/docs index` from the meta.json files and the frontmatter of each page. -->

The documentation of [mongozod](https://github.com/tserdeiro/mongozod), one Markdown file per
page. Read it here, at [mongozod.dev/docs](https://mongozod.dev/docs), or in
`node_modules/mongozod/dist/docs/` when mongozod is installed, where it matches the installed
version.

- [Introduction](./index.md): What MongoZod is, what it adds to the MongoDB driver and Zod, and where to start.

## Getting started

- [Why MongoZod](./getting-started/why-mongozod.md): How MongoZod compares with Mongoose and with the driver and Zod by hand, the Mongoose issues it solves and when not to use it.
- [Installation](./getting-started/installation.md): Install MongoZod, and the versions of Node.js, TypeScript, Zod and the MongoDB driver it needs.
- [Quick start](./getting-started/quick-start.md): Define a model from a Zod schema, write and read documents, and accept queries from a client, in one file.
- [Connection](./getting-started/connection.md): What to set on the MongoClient, on the database user and on the server for an app that uses MongoZod.
- [AI agents](./getting-started/ai-agents.md): Point a coding agent at the docs installed with MongoZod, and the mistakes agents trained on Mongoose tend to make.

## Guides

- [Schemas](./guides/schemas.md): Describe a stored document with a Zod schema, from its _id and defaults to the types a model takes and returns.
- [Models](./guides/models.md): Define a model with mongozod(), connect it to a database, and reach the driver for what the model does not wrap.
- [Operations](./guides/operations.md): The driver's collection methods as a model wraps them, with their options, results and cursors.
- [Validation](./guides/validation.md): What MongoZod validates on each write, how it checks upserts, and the ZodError it throws when a write does not fit.
- [TypeScript](./guides/typescript.md): How the schema types filters, updates, projections and sorts, and the types to pass them through services and repositories.
- [BSON types](./guides/bson-types.md): Store ObjectId, Decimal128, binary data, UUIDs, dates, sets and GeoJSON, and take them as JSON from clients.
- [Endpoint inputs](./guides/endpoint-inputs.md): Accept MongoDB filters, updates, sorts, projections and populate from clients, limited to what each endpoint declares.
- [Security](./guides/security.md): What MongoZod protects against when an endpoint takes a query from a client, and what stays with your application.
- [Pagination](./guides/pagination.md): Page through a collection with mz.after, the keyset pagination of MongoDB's range queries, or with skip and limit.
- [Populate](./guides/populate.md): Declare the references between models and replace the stored ids with the documents they point to.
- [Virtuals](./guides/virtuals.md): Compute fields from the stored ones when you read, without storing them.
- [Timestamps](./guides/timestamps.md): Fill createdAt when a document is created and updatedAt on every write with the timestamps option.
- [Document types](./guides/document-types.md): Store several types of document in one collection with a z.discriminatedUnion, with subtypes up to three levels.
- [Aggregation](./guides/aggregation.md): Run aggregation pipelines, validate and type their results with a schema, and check the leading $match stages.
- [Sync](./guides/sync.md): Create the indexes a model declares and apply a $jsonSchema validator generated from its schema, with sync().
- [Transactions](./guides/transactions.md): Run several operations atomically with the driver's withSession and withTransaction, passing the session to each operation.
- [Plugins](./guides/plugins.md): Add plugins to a model, pass the options and the context they take, and call the methods they add.

## Plugins

- [Soft delete](./plugins/soft-delete.md): Mark documents as deleted instead of removing them, and hide them from reads and updates, with the softDelete plugin.
- [Writing plugins](./plugins/writing-plugins.md): Write a plugin with definePlugin, with its fields, fills, options, context, hooks, middleware and methods.

## Migrating from Mongoose

- [Migrating from Mongoose](./mongoose/index.md): Move a Mongoose app to MongoZod one model at a time, on the connection Mongoose already opened, with a prompt for your coding agent.
- [Mongoose cheatsheet](./mongoose/cheatsheet.md): Each Mongoose feature with its MongoZod equivalent, from schema types and options to queries, populate, middleware and indexes.
- [Differences from Mongoose](./mongoose/differences.md): What works another way than in Mongoose, such as explicit writes instead of save(), filters without casting, __v and an explicit sync().

## Recipes

- [IDs](./recipes/ids.md): Choose how the _id of each document is generated, compare ObjectIds, and add the id virtual that Mongoose had.
- [Multi-tenant](./recipes/multi-tenant.md): Give each tenant its own database, with db as a function that returns the database of the current request.
- [Repositories](./recipes/repositories.md): Write generic helpers, such as paginate, and services per model, typed with ReadOf, FilterOf and InsertOf.
- [Transforms](./recipes/transforms.md): Hash a password before it is stored, compute a field from others, and check the database inside a transaction.
- [Schema migrations](./recipes/schema-migrations.md): Add a field or a virtual to a collection that already has documents, and list the documents that don't fit first.
- [HTTP APIs](./recipes/http-apis.md): Take a filter in a GET request, read an id from the route, turn errors into responses and log them readably.
- [Search](./recipes/search.md): Search a term in several fields, with MongoDB's text search, MongoDB Search, or mz.term for a search box without either.
- [Streams](./recipes/streams.md): Read many documents batch by batch with for await and Node.js streams, and follow changes with change streams.
- [Dates and money](./recipes/dates-and-money.md): Store a date without a time as a string, store money as Decimal128, and compare decimals in filters.
- [Schema patterns](./recipes/schema-patterns.md): Model a tree with a recursive schema, and write to a key of a record that is only known at runtime.

## API reference

- [mongozod](./api/mongozod.md): The reference of the `mongozod` entry point, with mongozod(), the model, its operations and cursors, definePlugin and the types.
- [mongozod/mzod](./api/mzod.md): The reference of mongozod/mzod, the builders of endpoint inputs and the BSON field types of a document schema.
