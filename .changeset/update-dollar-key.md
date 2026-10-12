---
'mongozod': patch
---

A path of an update with a key that starts with `$`, such as `reactions.$x` on a record, does not
compile and throws a `ZodError`, as the same key does in an insert: MongoDB stored it. The
destination of a `$rename` too.
