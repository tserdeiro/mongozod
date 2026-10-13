---
'mongozod': patch
---

`mz.filter` and `mz.after` reject a value that is an object with a key starting with `$`, which MongoDB reads as operators. A field that takes any object, such as `z.record()`, `z.unknown()` or `z.looseObject()`, let a client send `{ $ne: null }` as its value and get every document.
