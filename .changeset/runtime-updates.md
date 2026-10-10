---
'mongozod': minor
---

Validate updates at runtime with the same rules as their types: each value is parsed with the schema
of its path, each operator only applies to the fields it fits, and the filter or the `arrayFilters`
fix the type of document an update writes. `undefined` keys are dropped. An upsert also validates
the document the server would insert and adds the defaults it lacks with `$setOnInsert`, the `_id`
included, and the upsert of a replacement needs the `_id` in its filter. Keys with a `.` or starting
with `$` are rejected in any value written. Every problem is thrown in one `ZodError`.
