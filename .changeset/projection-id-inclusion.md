---
'mongozod': patch
---

A projection that includes the `_id` without other inclusions or exclusions, such as `{ _id: 1 }`
alone or with a `$slice`, is an inclusion, as in MongoDB 8.2: its type was the whole document,
and the reads with virtuals or a one-to-many `populate` planned it as an exclusion, so `populate`
found no document for such a projection.
