---
'mongozod': patch
---

A filter key whose value may be `undefined` says what to do. The types say `"status" may be undefined, which would match the documents without it: leave the key out, or write null or { $exists: false }`, and a `ZodError` at runtime, at the path of the key, says the same. Before, the types said `Type 'undefined' is not assignable to type 'Value<…>'`, and the runtime message only described the driver without `ignoreUndefined`.
