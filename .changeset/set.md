---
'mongozod': minor
---

Add `mz.set(item)`, from `mongozod/mzod`: the array of `$addToSet`, which keeps each value once. A
repeated value throws a `ZodError`, with the equality of MongoDB's `uniqueItems`: numbers and BSON
values by their value, and objects by their fields in any order. The model's updates add to it only
with `$addToSet`: `$push`, or a write to one of its elements by its index or a positional operator,
does not compile and throws a `ZodError`. `sync()` sets `uniqueItems: true` in its `$jsonSchema`,
so the server also rejects a repeated value.
