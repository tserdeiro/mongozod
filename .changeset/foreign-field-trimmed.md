---
'mongozod': patch
---

The projection of a one-to-many `populate` cannot keep only some elements of the array that holds
the `foreignField`, with `$elemMatch`, `$slice` or `$`: the documents the other elements point to
were left out of the populated arrays, without an error. It does not compile, and throws a
`ZodError`.
