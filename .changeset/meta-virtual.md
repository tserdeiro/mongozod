---
'mongozod': patch
---

A `$meta` on a field a virtual reads changes it, as `$slice` does: a projection that asks for the
virtual does not compile, and one that keeps it leaves it out. It compiled and threw a `ZodError`,
computing the virtual on the score.
