---
'mongozod': patch
---

The `schema` of `aggregate()` validates each batch asynchronously, as the writes do, so it may have
async refinements: one threw Zod's `$ZodAsyncError`.
