---
'mongozod': patch
---

A method of a service that passes on options that may be `undefined`, such as `(filter, update, options?) => Model.updateMany(filter, update, options)`, no longer costs tens of thousands of type instantiations more with `exactOptionalPropertyTypes`: the options argument of the model takes an explicit `undefined`.
