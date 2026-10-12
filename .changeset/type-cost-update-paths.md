---
'mongozod': patch
---

Lower the type cost of `mz.update`: a list of suggested paths that its operator accepts is returned
as it is instead of being checked path by path while it is inferred.
