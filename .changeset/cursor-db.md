---
'mongozod': patch
---

A cursor of `find` or `aggregate` reads the database of the request it is created in, though it
starts on its first read: one created in a tenant's request and read after it read the default
database, without an error.
