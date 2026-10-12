---
'mongozod': patch
---

Lower the type cost of `mz.update`: when every path of an operator is suggested, its suggestions
reuse the declared list instead of intersecting it with another array type.
