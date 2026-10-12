---
'mongozod': minor
---

A `db` function is called on every operation, so it can return the database of each request, such
as a tenant's from an `AsyncLocalStorage`: it was called once, and every tenant wrote to the
database of the first one, without an error. The collection is kept per `Db`, and `model.db`,
`model.collection` and `sync()` use the database the function returns at the time. A function that
builds a `Db` each time, such as `() => client.db()`, now builds one per operation, a few
microseconds: pass `client.db()`, which the driver connects on the first operation, or keep the
`Db` in a variable.
