---
'mongozod': minor
---

Support the MongoDB driver 6.20, the one Mongoose 8 depends on, besides 7.x: the `mongodb` peer
range is now `^6.20.0 || ^7.0.0`, so a migration from Mongoose 8 can share its connection.
