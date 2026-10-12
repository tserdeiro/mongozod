---
'mongozod': patch
---

With `timestamps`, a replacement without an `updatedAt` takes the time of the write, as in Mongoose, instead of the value of its `createdAt`.
