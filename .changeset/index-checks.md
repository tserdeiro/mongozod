---
'mongozod': patch
---

An index without keys, `index({})`, does not compile and throws an `Error` when the model is
defined, and the keys of the `weights` of a text index are checked and suggested as paths of the
document: both compiled, and the server rejected them at `sync()` or weighted nothing.
