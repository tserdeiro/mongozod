---
'mongozod': minor
---

`mz.from(schema)` binds the builders of `mongozod/mzod` that take a document's schema, so the inputs of a module name it once: `mz.from(noteSchema).filter({ … })` is `mz.filter(noteSchema, { … })`, with the same checks, editor suggestions and result. It loads the six builders that take a schema: `after`, `filter`, `projection`, `sort`, `term` and `update`.
