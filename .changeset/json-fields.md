---
'mongozod': patch
---

`mongozod()` no longer overflows the stack on a schema with a `z.json()` field, whose lazy builds a
new schema each time it is read.
