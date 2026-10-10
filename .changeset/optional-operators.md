---
'mongozod': patch
---

A filter whose operators are optional, as in a type built from a client input, now compiles with
`$elemMatch` and `$not`.
