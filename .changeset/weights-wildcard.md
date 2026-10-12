---
'mongozod': patch
---

A text index rejects a weight on a wildcard under a path, such as `author.$**`, when the model is
defined, as MongoDB does at `sync()` (code 67), and the error of a weight names `weights` instead of
an index key.
