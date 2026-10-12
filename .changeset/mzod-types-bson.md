---
'mongozod': patch
---

The declarations of `mongozod/mzod` no longer load the driver's: they take `Document`, `ObjectId`,
`Binary` and the BSON types from `bson`, which the driver re-exports, as its runtime already did.
