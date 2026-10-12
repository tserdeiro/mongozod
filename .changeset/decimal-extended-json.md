---
'mongozod': minor
---

`mz.decimal128()` takes the Extended JSON a `Decimal128` gives with `JSON.stringify`,
`{ $numberDecimal: '10.50' }`, so a document an endpoint returns as JSON comes back without
`z.encode`, as the other BSON types of `mongozod/mzod` do.
