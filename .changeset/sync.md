---
'mongozod': minor
---

Add `sync()` and the `indexes` and `jsonSchema` options of `mongozod()`. `indexes` takes the
driver's `IndexDescription`s, with each key checked as a path of the document and
`partialFilterExpression` checked like a filter. `sync()` creates them and never drops one: an
existing index that differs fails with the driver's error, and the undeclared ones are returned in
`extraIndexes`. With `jsonSchema`, it also applies a `$jsonSchema` generated from the schema, with
the structure of each document, through `collMod` or when it creates the collection.
