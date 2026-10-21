---
'mongozod': patch
---

The keys of a record keyed by a TypeScript `enum`, such as `z.partialRecord(z.enum(Channel), z.number())`, are paths of the document in filters, updates, projections, sorts, `distinct` and the builders of `mongozod/mzod`, as they already were at runtime. Before, `'channels.chat'` did not compile, because a string literal is not assignable to a member of the enum.
