---
'mongozod': patch
---

A model with a `z.bigint()` on a client without `useBigInt64` throws its `Error` on every
operation: only the first one threw, and the next ones ran, reading longs as numbers.
