---
'mongozod': patch
---

`sync()` with `jsonSchema` takes a recursive schema written with getters, as Zod 4 recommends: it
threw a `RangeError` because only `z.lazy` stopped the recursion. The field through which the schema
leads back to itself has no rule, with either form.
