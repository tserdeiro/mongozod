---
'mongozod': minor
---

A path of `mz.filter` that declares no operator, `[]`, takes the value only, typed as the field's: `mz.filter(noteSchema, { _id: [] }).required({ _id: true })` is `{ _id: string }` for the router and for a typed client, which no longer narrow a union with `{ $eq }`. Before, `[]` compiled and took nothing.
