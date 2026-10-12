---
'mongozod': patch
---

`$unset` of an element of an array or a tuple, which MongoDB sets to `null`, is accepted only when
the element takes `null`, and `$rename` no longer takes an element, which MongoDB rejects: an
optional element of a tuple was unset to a `null` the schema rejects.
