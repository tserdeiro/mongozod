---
'mongozod': minor
---

`mongozod()` throws an `Error` when a field of the schema has a `.` or starts with `$`, at any
level, because no path can reach it.
