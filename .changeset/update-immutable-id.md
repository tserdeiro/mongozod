---
'mongozod': patch
---

An update writes the `_id` only with `$setOnInsert`, in its types, its suggestions and at runtime:
`$set`, `$unset`, the other operators and the target of `$rename` say that the `_id` is immutable,
which the server rejected with code 66. `mz.update` does not take it either.
