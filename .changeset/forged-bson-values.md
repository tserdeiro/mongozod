---
'mongozod': patch
---

`mz.objectId()`, `mz.decimal128()`, `mz.binary()` and `mz.uuid()` reject a plain object with a `_bsontype`, such as `{ "_bsontype": "ObjectId" }` from JSON: they recognize a BSON value as the driver's serializer does, by its `_bsontype` and bson's version symbol.
