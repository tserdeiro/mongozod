---
'mongozod': minor
---

Add `decimal128()` to `mongozod/codecs/bson`: a `Decimal128` field, the BSON type for money, that
takes a `Decimal128` or its string, such as `'10.50'`, as a JSON client sends it, and returns a
`Decimal128`. It rejects a number, which JSON rounds, and a string that bson would round. `z.encode`
turns it back into the string, and the `$jsonSchema` of `sync()` checks it as a `decimal`.
