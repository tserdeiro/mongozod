---
'mongozod': patch
---

`$rename` neither moves nor writes a path inside an element of an array, such as `items.0.name`,
which the server rejects with the code 2: only an element itself was rejected before. It does not
compile, and throws a `ZodError`.
