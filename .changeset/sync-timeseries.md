---
'mongozod': patch
---

`sync()` leaves out of `extraIndexes` the index MongoDB creates on the `metaField` and the
`timeField` of a time-series collection: it reported it as one the model does not declare.
