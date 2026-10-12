---
'mongozod': patch
---

A one-to-many reference with a dotted `foreignField` keeps it whatever the projection of its
`populate` does: one that included the object above it failed with a path collision, one that
excluded that object returned no documents, without an error, and one that included other fields
left an empty object.
