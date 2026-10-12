---
'mongozod': patch
---

A projection that asks only for a virtual that reads the `_id`, such as `{ id: 1 }`, returns only
the `_id` and the virtual: the server got an empty projection and returned every field.
