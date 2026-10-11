---
'mongozod': patch
---

A reference whose path goes through a record, or whose field stores one, throws an `Error` when
the model is defined, as its types reject it: `populate` left the ids of a path through a record
untouched, and dropped a record that it took for an id.
