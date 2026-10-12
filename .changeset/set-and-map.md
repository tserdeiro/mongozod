---
'mongozod': patch
---

A schema that stores a `z.set()` or a `z.map()` throws an `Error` when the model is defined, with
the path and the alternative: the driver stores a `Set` as an empty object and a `Map` as an
object, so the values were lost without a warning, or read back with another type. An array
without repeats is `mz.set()`, and dynamic keys are `z.record()`.
