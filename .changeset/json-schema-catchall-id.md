---
'mongozod': patch
---

The `$jsonSchema` of `sync()` declares the `_id` as an `objectId` when the schema leaves it out and
has a catchall, as it did for a strict object, and in each type of a nested discriminated union:
the catchall's rule rejected the `ObjectId` the driver generates, so every insert failed.
