---
'mongozod': patch
---

A `z.instanceof(Set)` or `z.instanceof(Map)`, as written, throws the `Error` of a `z.set()` or a
`z.map()` when the model is defined. The error of one in a tuple names its element, and the rest of
a tuple is checked too, which it was not, also for a `z.bigint()`.
