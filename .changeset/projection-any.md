---
'mongozod': patch
---

A read whose projection is typed as the driver's `Document`, or `any`, compiles, with every field
of the result optional, as any of them may be left out: the first such read of a file gave TS2589,
because the check walked the `any` values without end.
