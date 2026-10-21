---
'mongozod': patch
---

`mz.sort` types its input, the declared paths with `1` or `-1`, as `mz.projection` does. Before, its input was `unknown`, so a typed client, such as one of tRPC, did not know what a list sorts by, and accepted any value.
