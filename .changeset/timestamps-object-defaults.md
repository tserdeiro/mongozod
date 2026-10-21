---
'mongozod': patch
---

A `timestamps` object that leaves a field out, such as `{ updatedAt: false }` or `{ createdAt: 'created_at' }`, gives that field its default name in the types too, as the runtime does. Before, the types turned it off: inserts asked for `createdAt`, the schema check did not look for it, and an update could write it.
