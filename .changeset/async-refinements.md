---
'mongozod': minor
---

Writes validate with `parseAsync`, so a schema can have async refinements, such as one that checks
the database, like the async validators of Mongoose: inserts, replacements, updates path by path
and `bulkWrite` await them. A sync parse threw a `$ZodAsyncError` on every write of such a schema.
