---
'mongozod': patch
---

An upsert no longer writes to `Object.prototype` when a filter key or an update path has a `__proto__` segment, such as `$set: { 'settings.__proto__.isAdmin': true }`: the document it would insert is built from own fields, and `__proto__` is a field name, as MongoDB stores it. An insert also keeps a `__proto__` key of a value, such as one from `JSON.parse`, instead of dropping it.
