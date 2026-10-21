---
'mongozod': patch
---

A filter key whose value may be `undefined` says what to do, in the types and at runtime: `"status" may be undefined, which would match the documents without it: leave the key out, or write null or { $exists: false }`. Before, the types said `Type 'undefined' is not assignable to type 'Value<…>'`, and the runtime message only described the driver without `ignoreUndefined`.
