---
'mongozod': patch
---

When the document an upsert would insert lacks a required field, its issue says to give it in the
filter or with `$setOnInsert`, after Zod's message.
