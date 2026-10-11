---
'mongozod': minor
---

A model's schema can be a discriminated union of discriminated unions, for types with subtypes, up
to three levels. Each union keeps its own key: an update fixes in the filter the discriminators of
the types it writes, as `{ fuel: 'electric', kind: 'car' }`, and `timestamps` and plugins need
their fields in each final type.
