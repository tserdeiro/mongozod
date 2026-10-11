---
'mongozod': patch
---

At runtime, `$currentDate` takes `true` or `{ $type: 'date' }`, as its types do: a
`{ $type: 'timestamp' }` that arrived without types wrote a BSON Timestamp in a date field.
