---
'mongozod': patch
---

An upsert whose filter gives an object `_id` with its keys in another order than the schema says
so: the `_id` it sends in `$setOnInsert` is in the order of the schema, which the server compares
in order. It said that the filter gave another `_id`, also when `$setOnInsert` wrote it as the
filter did.
