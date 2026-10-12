---
'mongozod': patch
---

The editor no longer suggests `an index takes at least one key` among the keys of every index: an
index without keys is rejected only when the model is defined, with an `Error`.
