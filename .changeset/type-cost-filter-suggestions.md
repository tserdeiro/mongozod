---
'mongozod': patch
---

Lower the type cost of `mz.filter`: the suggestions of a path the declarations already list reuse
that list, which the check validates, instead of intersecting it with another array type.
