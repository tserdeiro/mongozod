# mongozod

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
