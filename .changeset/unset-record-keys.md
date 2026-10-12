---
'mongozod': patch
---

`$unset` and the source of `$rename` take a key its object may lack: one of a record whose keys are
not a fixed set, such as `z.record(z.string(), …)` or a `z.partialRecord`, or one a catchall takes.
They said the key was required, as the value of the record is. A record with the keys of an enum
has all of them, as Zod validates it.
