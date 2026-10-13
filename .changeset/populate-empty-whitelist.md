---
'mongozod': patch
---

`mz.populate` throws an `Error` when it is declared with a whitelist that has no fields: a client that sent `true` got `projection: {}`, which MongoDB reads as the whole referenced document.
