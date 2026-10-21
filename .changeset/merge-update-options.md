---
'mongozod': patch
---

The JSDoc of `UpdateMethod` shows a method that adds options of its own to the caller's, such as `{ ...options, returnDocument: 'after' }`, which costs about 60,000 type instantiations once per program, and a method of its own for an option that the check of the update reads, such as `upsert: true`.
