---
'mongozod': patch
---

An upsert whose filter gives the `_id` takes in `$setOnInsert` only the same `_id`, which the
server takes: another value, or the `_id` when the filter gives a part of it, made the server
reject the update with the code 66. They do not compile, and throw a `ZodError`.
