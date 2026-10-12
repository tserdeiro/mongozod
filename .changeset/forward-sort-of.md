---
'mongozod': patch
---

A function that takes a sort constrained by `SortOf` can pass it to `find`, `findOne` and `.sort()`,
as the JSDoc of `SortOf` says: the check that rejects a sort in a string did not resolve on a
generic, and it failed with TS2322 or TS2345.
