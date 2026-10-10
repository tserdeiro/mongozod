---
'mongozod': minor
---

Add `sync()` and the `indexes` and `jsonSchema` options of `mongozod()`. `indexes` is a callback
that declares each index with `index(key, options)`, like the driver's `createIndex`, so that the
editor suggests the paths: each key is checked as a path of the document and
`partialFilterExpression` like a filter. `sync()` creates them and never drops one: an existing
index that differs fails with the driver's error, and the undeclared ones are returned in
`extraIndexes`. With `jsonSchema`, it also applies a `$jsonSchema` generated from the schema, with
the structure of each document, through `collMod` or when it creates the collection.
