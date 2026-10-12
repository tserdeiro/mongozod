---
'mongozod': patch
---

Lower the type cost of `mz.filter`: the declarations under a field are only built for the fields
that declare `$elemMatch`.
