---
'mongozod': patch
---

The `Error` for a schema that transforms the whole document says where `.overwrite()` runs: on inserts, replacements and the document an upsert would insert, not on updates.
