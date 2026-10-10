---
'mongozod': minor
---

Add the `timestamps` option: `createdAt` when a document is created and `updatedAt` on every write,
renamed or turned off per field. Inserts keep the dates they bring, updates cannot write the stamped
fields (`$setOnInsert` can give `createdAt`), and `timestamps: false` skips them on one operation.
The schema declares both fields, taking a `Date` and with a `.default()`.
