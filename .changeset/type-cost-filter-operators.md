---
'mongozod': patch
---

Lower the type cost of `mz.filter`: a list of operators that all apply, without `$elemMatch`, is
returned as it is instead of being checked operator by operator while it is inferred.
