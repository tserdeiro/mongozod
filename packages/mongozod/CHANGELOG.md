# mongozod

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
