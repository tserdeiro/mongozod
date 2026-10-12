---
'mongozod': patch
---

An upsert whose filter gives the `_id`, or a part of it, does not take the `_id` in `$setOnInsert`:
it inserts the one of the filter, so the server rejected another value or a part with the code 66,
and the same value repeated it. It does not compile, and throws a `ZodError`.
