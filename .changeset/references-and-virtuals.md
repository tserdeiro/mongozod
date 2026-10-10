---
'mongozod': minor
---

Add the `references` and `virtuals` options of `mongozod()`. A reference points to a function that
returns another model, or to a collection and its schema, and `populate` replaces it with the
document in `find`, `findOne` and the `findOneAnd*` operations: `true` for the whole document or a
projection of it, with one `$in` query per reference and per batch, `null` for a missing document,
and an array of ids keeps the ones found. A virtual is a schema that picks the fields it reads and
transforms them into its value: reads compute it, and a projection that asks for it also asks the
server for those fields and returns only what it asked for.
