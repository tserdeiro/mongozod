---
'mongozod': patch
---

The updates of a `z.unknown()` field take any value, as its input does: `$set` takes an `unknown` and `null`, also under the field and in a `z.record(z.string(), z.unknown())`, and `$push` takes an `unknown` element. Before, the types turned `unknown` into `{}`, which took neither.
