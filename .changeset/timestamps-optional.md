---
'mongozod': minor
---

`timestamps` no longer needs a `.default()` on `createdAt` and `updatedAt`: the schema declares
what is stored, such as `date()`, and inserts and replacements take those fields as optional while
`timestamps` is on. An operation with `timestamps: false` needs them, unless the schema gives them a
`.default()`.
