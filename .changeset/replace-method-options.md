---
'mongozod': patch
---

`ReplaceMethod`, and `FilterMethod` with driver options that have a `sort`, such as `FindOneAndDeleteOptions`, type that `sort` as the model does, so a method that passes its options on to the model compiles.
