# mongozod

## 0.4.0

### Minor Changes

- d804f8c: `npx mongozod agents-md` writes the mongozod rules for coding agents to `AGENTS.md`, or to the file of `--output`, such as `CLAUDE.md`: a short block between its markers that points the agent at the docs of the installed version, created when the file is missing, replaced when it has it, and appended otherwise, without touching the rest. The block also asks the agent to suggest that the user report a friction or a case the docs do not cover as an issue, which is reviewed promptly, without opening it itself.
- 1cb5ec5: The official `autoIndex` plugin, in `mongozod/plugins/auto-index`, creates the indexes a model declares on its first operation in each database, as Mongoose's `autoIndex` does, for development, tests and serverless platforms. A model exposes the indexes it declares in `indexes`, and `AnyModel` adds `indexes` and a `collection` with `createIndexes`. The Sync guide says when to run `sync()`.
- 1d15b86: `BulkWriteOf<M, Ops, O>` types the operations of a `bulkWrite` that a function takes and passes to the model, such as a service, with each operation checked like the model's, as `FilterOf` and `UpdateOf` do for filters and updates.
- 9a83a19: `FindOptionsOf<M>` types the options of a `find` or a `findOne` that a service takes from a router: the driver's, a `sort` of the paths of the document and, on a model with references, a `populate` as `mz.populate` outputs it, plus the options and the context its plugins ask for. The router passes the output of its inputs as it is, and the server its own sort or limit.
- c03be02: A path of `mz.filter` that declares no operator, `[]`, takes the value only, typed as the field's: `mz.filter(noteSchema, { _id: [] }).required({ _id: true })` is `{ _id: string }` for the router and for a typed client, which no longer narrow a union with `{ $eq }`. Before, `[]` compiled and took nothing.
- 8a1d6e6: `mz.from(schema)` binds the builders of `mongozod/mzod` that take a document's schema, so the inputs of a module name it once: `mz.from(noteSchema).filter({ … })` is `mz.filter(noteSchema, { … })`, with the same checks, editor suggestions and result. It loads the six builders that take a schema: `after`, `filter`, `projection`, `sort`, `term` and `update`.
- a0bbf17: `mz.term(schema, mask)` builds the search term a client can send, as in a search box: each word of the term has to appear in one of the declared paths, as part of a word, without telling case or accents apart. It builds a `$regex` per word and path from the escaped text, so the client never sends a pattern, and gives `{}` for an empty term. The Search recipe compares it with `$text` and MongoDB Search.
- db21c98: Method types for services: `FilterMethod`, `UpdateMethod`, `ReplaceMethod`, `BulkWriteMethod`, `AggregateMethod` and `DistinctMethod`. Given with `satisfies`, an arrow function takes the type parameters that check what it passes to the model, so a service method no longer writes them, and keeps its own result. `PipelineOf<M, P>` types a pipeline a function passes to `aggregate`.
- 7a57bae: `UpdateOptionsOf<M, U, O>` types the options of an update that a function passes to the model, such as a service: their `arrayFilters` are checked against the identifiers of the update, and their `sort`, `projection` and `populate` against the schema, as the model does. One service method can take an update with a positional `$[id]` and its `arrayFilters`, and a `findOneAndUpdate` that takes them returns the document.

### Patch Changes

- 6ff95fa: `npx mongozod --help` prints the usage, and an unknown option or `--output` without a file prints what is wrong and the usage instead of a stack trace.
- 0ce835f: The keys of a record keyed by a TypeScript `enum`, such as `z.partialRecord(z.enum(Channel), z.number())`, are paths of the document in filters, updates, projections, sorts, `distinct` and the builders of `mongozod/mzod`, as they already were at runtime. Before, `'channels.chat'` did not compile, because a string literal is not assignable to a member of the enum.
- 92e5f85: `mz.sort` types its input, the declared paths with `1` or `-1`, as `mz.projection` does. Before, its input was `unknown`, so a typed client, such as one of tRPC, did not know what a list sorts by, and accepted any value.
- 89ac12e: The JSDoc of `mongozod/mzod` says that a bundler that tree-shakes leaves `bson` out, and that React Native's Metro keeps it.
- cd18f9c: A method of a service that passes on options that may be `undefined`, such as `(filter, update, options?) => Model.updateMany(filter, update, options)`, no longer costs tens of thousands of type instantiations more with `exactOptionalPropertyTypes`: the options argument of the model takes an explicit `undefined`.
- 7abeb23: The JSDoc of `mz.projection` warns against `.default({})`, which Zod returns without parsing, and no longer against `.optional()`, which runs the builder's default since Zod 4.5.
- 78b13d3: `ReadOf` and `findOneAndUpdate` take a `populate` or a `projection` that is optional or may be `undefined`, such as the output of a `mz.populate()` or `mz.projection()` input, and type the document as `findOne` does with the same options. Before, they typed it as if nothing was populated, and `findOneAndUpdate` did not compile with `exactOptionalPropertyTypes`.
- 7dc196d: The JSDoc of the `indexes` and `timestamps` options, of `sync()` and of `mongozod/mzod` reflect this release: `autoIndex`, when to run `sync()`, a `timestamps` field the object leaves out, and the `{ filter, options }` shape of a list input. `npx mongozod agents-md` says when it creates the file.
- 9059fc5: `ReplaceMethod`, and `FilterMethod` with driver options that have a `sort`, such as `FindOneAndDeleteOptions`, type that `sort` as the model does, so a method that passes its options on to the model compiles.
- 7f3db1a: A service that passes a filter and an update to the model costs far less to type check. The update's check now reads only the options it depends on, so a service whose options differ from the model's call only in others, such as `returnDocument`, no longer makes TypeScript compare two checks of the update: about 7,000 type instantiations instead of 82,000. A service that passes `FindOptionsOf` to `find` or `findOne` costs about 4,000 instead of 104,000. `UpdateMethod<M, O>` types a method that passes its own options, such as `{ returnDocument: 'after' }`.
- 61e5556: A `timestamps` object that leaves a field out, such as `{ updatedAt: false }` or `{ createdAt: 'created_at' }`, gives that field its default name in the types too, as the runtime does. Before, the types turned it off: inserts asked for `createdAt`, the schema check did not look for it, and an update could write it.
- 26a6055: A filter key whose value may be `undefined` says what to do. The types say `"status" may be undefined, which would match the documents without it: leave the key out, or write null or { $exists: false }`, and a `ZodError` at runtime, at the path of the key, says the same. Before, the types said `Type 'undefined' is not assignable to type 'Value<…>'`, and the runtime message only described the driver without `ignoreUndefined`.
- 89a3407: The updates of a `z.unknown()` field take any value, as its input does: `$set` takes an `unknown` and `null`, also under the field and in a `z.record(z.string(), z.unknown())`, and `$push` takes an `unknown` element. Before, the types turned `unknown` into `{}`, which took neither.
- b7f0381: An update or a sort kept in a variable, whose literals TypeScript widens, says why it does not compile: `"nextRunAt" is a string: $unset takes '', 1 or true, so declare the update with as const`, and the same for `$currentDate`, `$pop` and a sort, as a projection already did.

## 0.3.3

### Patch Changes

- 345bfa7: The `$options` of `mz.filter` takes only the flags MongoDB takes, `i`, `m`, `x`, `s` and `u`: any other reached the server, which rejects it with the code 51108.
- 345bfa7: `mz.filter` and `mz.after` reject a `RegExp` or a `BSONRegExp` as a value, which MongoDB matches as a pattern where the endpoint declared an equality: a transport such as superjson sends one, and a transform can build one. A pattern enters through a declared `$regex` only.
- 345bfa7: `mz.filter` and `mz.after` check the values the schema returns too, not only the ones the client sends: a field with a transform that parses JSON turned a string into `{ $ne: null }` after the check, and MongoDB read it as an operator.
- 345bfa7: The model throws a `ZodError` when a filter has an `undefined` value, at any level: the driver sends it as `null`, which matches the documents without the field, so `findOne({ email, resetToken: body.token })` with a body without a token matched the users without one. The types already rejected it, and a value typed `any` compiled.
- 345bfa7: `mz.populate` throws an `Error` when it is declared with a whitelist that has no fields: a client that sent `true` got `projection: {}`, which MongoDB reads as the whole referenced document.
- 345bfa7: The queries of `populate` take the `maxTimeMS` and the `signal` of the read that asks for them, as they take its session: the limit of a read bounds each of its queries, not only the first one.
- 345bfa7: `$inc` and `$mul` reject `Infinity` and `NaN`, which the server stores and no `z.number()` takes back.
- 345bfa7: An update whose path is `__proto__`, on a schema that takes any key, such as `z.looseObject()`, is written as a field, as MongoDB stores it: the model dropped it in silence.
- 345bfa7: `mz.update` rejects a value of `$set` with a key that has a `.` or starts with `$`, at any level, as the model does when it writes: on a field that takes any object, such as `z.record()` or `z.unknown()`, the builder accepted it and the write threw.

## 0.3.2

### Patch Changes

- c3db03c: `mz.after` gives `{}`, the first page, when the client sends nothing, so a list no longer needs `.default({})` on it. `mz.sort` and `mz.populate` are optional, so they no longer need `.optional()`; a default sort still takes `.default()`. `mz.filter` keeps no default: a missing filter means everything in a list and has to fail in a filter by id, which each endpoint decides.

## 0.3.1

### Patch Changes

- aeead5c: `mz.projection` gives the mask when the client sends no projection, so its key is optional in an input and `.prefault({})` is no longer needed. A model without a projection reads the whole document, with the fields the mask leaves out. Don't wrap it in `.optional()`, which skips the builder.

## 0.3.0

### Minor Changes

- 7d1c249: `mz.projection` always returns an inclusion of the paths its mask declares, so a client never gets a field the mask leaves out. MongoDB reads an exclusion such as `{ title: 0 }`, and `{}`, as the whole document: now an exclusion means the declared paths but those, and `{}` means all of them. Each included path is `1`. A mask with a path and a path inside it throws, because MongoDB rejects both in one projection. Declare it with `.prefault({})` so a missing projection also stays within the mask.

### Patch Changes

- 0fd616c: `mz.filter` and `mz.after` reject a value that is an object with a key starting with `$`, which MongoDB reads as operators. A field that takes any object, such as `z.record()`, `z.unknown()` or `z.looseObject()`, let a client send `{ $ne: null }` as its value and get every document.
- 2b45f1c: `mz.objectId()`, `mz.decimal128()`, `mz.binary()` and `mz.uuid()` reject a plain object with a `_bsontype`, such as `{ "_bsontype": "ObjectId" }` from JSON: they recognize a BSON value as the driver's serializer does, by its `_bsontype` and bson's version symbol.
- e6cecf6: An upsert no longer writes to `Object.prototype` when a filter key or an update path has a `__proto__` segment, such as `$set: { 'settings.__proto__.isAdmin': true }`: the document it would insert is built from own fields, and `__proto__` is a field name, as MongoDB stores it. An insert also keeps a `__proto__` key of a value, such as one from `JSON.parse`, instead of dropping it.

## 0.2.0

### Minor Changes

- 08f56e6: The first release: models whose Zod schema validates every write, types every read and defines
  what each endpoint accepts, on top of the official MongoDB driver. See https://mongozod.dev/docs.
