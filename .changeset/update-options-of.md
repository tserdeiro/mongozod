---
'mongozod': minor
---

`UpdateOptionsOf<M, U, O>` types the options of an update that a function passes to the model, such as a service: their `arrayFilters` are checked against the identifiers of the update, and their `sort`, `projection` and `populate` against the schema, as the model does. One service method can take an update with a positional `$[id]` and its `arrayFilters`, and a `findOneAndUpdate` that takes them returns the document.
