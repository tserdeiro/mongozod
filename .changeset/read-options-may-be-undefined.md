---
'mongozod': patch
---

`ReadOf` and `findOneAndUpdate` take a `populate` or a `projection` that is optional or may be `undefined`, such as the output of a `mz.populate()` or `mz.projection()` input, and type the document as `findOne` does with the same options. Before, they typed it as if nothing was populated, and `findOneAndUpdate` did not compile with `exactOptionalPropertyTypes`.
