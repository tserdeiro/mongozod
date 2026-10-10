---
'mongozod': minor
---

Add `mongozod()`, which defines the model of a collection from its Zod schema. The model wraps the
driver's operations with their options and results: inserts and replacements are validated with
the schema and never write `undefined` keys, `insertOne` and `insertMany` also return the stored
documents, and `find` and `aggregate` return a cursor that can be awaited for the array.
`aggregate` validates each document with the `schema` option when it is given.
