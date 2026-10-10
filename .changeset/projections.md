---
'mongozod': minor
---

Check projections against the schema and type what they return, following MongoDB 8.2: in the
options of `find`, `findOne` and the `findOneAnd*` operations, and in the cursor's `project()`.
What MongoDB accepts but answers differently does not compile, and `{ $meta: 'textScore' }` adds the
relevance of a text search, which `sort` can use.
