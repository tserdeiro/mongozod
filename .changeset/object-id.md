---
'mongozod': minor
---

Add `objectId()`, from `mongozod/codecs/bson`: an `ObjectId` field that takes an `ObjectId` or its
24-character hex string, as a JSON client sends it, and returns an `ObjectId`. `z.encode` turns it
back into the hex string, and the `$jsonSchema` of `sync()` checks it as an `objectId`. It
recognizes an `ObjectId` by its `_bsontype`, so it takes the driver's even when `instanceof` would
fail, and it imports `bson`, never the driver, so it also runs in web and native clients. `bson` is
an optional peer dependency, of the same major as the driver.
