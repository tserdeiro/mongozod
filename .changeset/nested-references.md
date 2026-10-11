---
'mongozod': minor
---

A reference can be a path inside objects and arrays of objects, such as `items.product` or
`shipping.carrier`: `populate` replaces the ids in each element and object, with one query per
reference, and the type of the read follows. A projection that includes the object above a
reference returns it without a path collision, and one that excludes it does not compile. A path
with an array index, such as `items.0.product`, throws an `Error` when the model is defined.
