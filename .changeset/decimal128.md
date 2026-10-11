---
'mongozod': minor
---

Add `decimal128()` to `mongozod/codecs/bson`: a `Decimal128` field, the BSON type for money, that
takes a `Decimal128`, its string, such as `'10.50'`, or a number, as a JSON client sends them, and
returns a `Decimal128`. A number has to be the decimal it was written as: one with more than 15
significant digits, such as the `0.30000000000000004` of `0.1 + 0.2`, fails and asks for the string,
and so does a string that bson would round. `z.encode` turns it back into the string, and the
`$jsonSchema` of `sync()` checks it as a `decimal`.
