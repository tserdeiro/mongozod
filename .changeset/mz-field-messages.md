---
'mongozod': patch
---

A missing `mz.objectId()`, `mz.date()`, `mz.decimal128()`, `mz.binary()` or `mz.uuid()` says
`received undefined`, as Zod says of a missing field, after what the field takes: it said only that
the value was invalid. `mz.populate` says what a reference takes when a client sends `{}` or an
exclusion, instead of `Invalid input`.
