---
'mongozod': patch
---

A projection with `string` keys, such as a `Record<string, 0 | 1>` built at runtime, says that it
takes the driver's `Document` type: it said to type its values as `0 | 1`, which gave another error.
