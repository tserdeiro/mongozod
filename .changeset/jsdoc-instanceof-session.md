---
'mongozod': patch
---

The JSDoc of `mz.objectId()` says to compare with `.equals()` and check with `ObjectId.isValid()`,
not with `instanceof`, which fails between the ES module and CommonJS builds of `bson`; and the one
of `schema` says that an async refinement that queries the database runs outside the session of a
transaction.
