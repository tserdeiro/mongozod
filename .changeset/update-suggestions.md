---
'mongozod': patch
---

The editor suggests the positional paths of an update, such as `items.$.qty`, besides
`items.$[].qty`, and the fields of the elements inside a `$pull` condition.
