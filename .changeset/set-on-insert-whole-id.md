---
'mongozod': patch
---

`$setOnInsert` writes the `_id` whole: a path inside it, such as `'_id.day'`, compiled and failed
with code 66 as soon as the filter or another path gave a part of the `_id`.
