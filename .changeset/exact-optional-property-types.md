---
'mongozod': patch
---

Support `exactOptionalPropertyTypes`: what a `mz.filter()` or `mz.populate()` schema returns, whose
optional keys Zod types as `| undefined`, can be passed to the model's operations, and the
`projection`, `sort` and `populate` options take `undefined`. A filter key set to `undefined` by
hand still does not compile, because the driver sends it as `null`.
