---
'mongozod': minor
---

Add `mongozod/adapters/better-auth`, a Better Auth database adapter whose reads and writes go
through MongoZod models, so their plugins, such as `softDelete`, apply to the tables Better Auth
manages; the other tables go through the driver, as in the official MongoDB adapter. It also
exports `toAdditionalFields()`, which builds Better Auth's `additionalFields` from the schema of a
model, and `transactionSession()`, the session of the running Better Auth transaction for a
database hook. `better-auth` is an optional peer dependency, `^1.7.0`.
