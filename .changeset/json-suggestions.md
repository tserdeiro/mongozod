---
'mongozod': patch
---

A model with a `z.json()` field compiles in reads and writes: the paths the editor suggests no
longer recurse without end through its union.
