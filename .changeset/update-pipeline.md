---
'mongozod': minor
---

Updates with an aggregation pipeline compile and run with `updatePipeline: true`, as in Mongoose 9,
in `updateOne`, `updateMany`, `findOneAndUpdate` and `bulkWrite`. Each stage must be one MongoDB
takes in an update (`$set`, `$addFields`, `$unset`, `$project`, `$replaceWith` or `$replaceRoot`),
and its values are not validated: they are expressions the server computes. They go through the
plugins, so `softDelete` still skips the deleted documents, and `timestamps` adds a last `$set`
stage with `updatedAt` and, in an upsert, `createdAt` when the document has none. Plugin hooks get
the pipeline as the operation's `update`.
