---
'mongozod': minor
---

A model whose schema has a `z.bigint()` needs a client or a `Db` with `useBigInt64: true`: its
first operation throws an `Error` that names the path otherwise. Without that option the driver
reads a long as a number, or as a `Long` past 2^53, while the reads were typed with a `bigint`.
