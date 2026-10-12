---
'mongozod': patch
---

A `z.instanceof(Set)` or `z.instanceof(Map)` throws the `Error` of a `z.set()` or a `z.map()` when
the model is defined, and the error of one in a tuple names its element, also in the rest of the
tuple, which was not checked.
