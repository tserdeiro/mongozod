---
'mongozod': minor
---

Check updates against the schema, path by path, with every update operator of MongoDB: in
`updateOne`, `updateMany`, `findOneAndUpdate` and the updates of `bulkWrite`. Each path must exist
in every type of document the filter allows, `arrayFilters` are required when an update uses a
`$[id]` and are checked against its elements, and an update with an aggregation pipeline does not
compile. The editor suggests the paths of filters, sorts and updates.
