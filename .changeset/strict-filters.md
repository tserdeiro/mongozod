---
'mongozod': minor
---

Check filters against the schema, key by key, with every query operator of MongoDB: in every
operation, in the filters of `bulkWrite` and in the leading `$match` stages of `aggregate`. Sorts
take the object form with their keys checked, `distinct` takes a path and types its values, and a
filter value that can be `undefined` does not compile, because the driver sends it as `null`.
