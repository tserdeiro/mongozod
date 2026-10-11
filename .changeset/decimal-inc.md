---
'mongozod': minor
---

`$inc` and `$mul` take a `Decimal128` field, such as one of `mz.decimal128()`, in the model and in
`mz.update`: the value is parsed with the field's schema, so a `'0.10'` from a JSON client arrives
as an exact `Decimal128`.
