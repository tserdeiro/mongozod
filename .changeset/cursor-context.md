---
'mongozod': patch
---

A cursor of `find` or `aggregate` runs in the async context it is created in, like a promise: read
after its request, its `populate` read the referenced documents of the default database, and the
hooks of its plugins did not see the stores of an `AsyncLocalStorage`. The `db` function is called
on the first read again, so an error it throws rejects the read instead of throwing from `find()`.
