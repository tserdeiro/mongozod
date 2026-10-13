---
'mongozod': patch
---

`mz.update` rejects a value of `$set` with a key that has a `.` or starts with `$`, at any level, as the model does when it writes: on a field that takes any object, such as `z.record()` or `z.unknown()`, the builder accepted it and the write threw.
