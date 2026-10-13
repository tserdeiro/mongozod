---
'mongozod': patch
---

`mz.filter` and `mz.after` check the values the schema returns too, not only the ones the client sends: a field with a transform that parses JSON turned a string into `{ $ne: null }` after the check, and MongoDB read it as an operator.
