---
'mongozod': minor
---

Each value of `populate` is `true` or an object of options named like the driver's: `projection`,
`filter`, which leaves out the referenced documents that do not match (a single reference becomes
`null`, an array drops them), and `sort`, which orders an array of references. A projection now
goes in `projection`: `populate: { createdBy: { projection: { email: 1 } } }`. The options are
checked against the referenced schema, and `mz.populate` returns this shape.
