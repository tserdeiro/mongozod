---
'mongozod': patch
---

Fix a Better Auth request that hung inside a transaction, such as registering an OAuth client:
the adapter waited, from the transaction, for an index build on a collection the transaction had
already read or written, and the build waited for the transaction to end. The adapter of a
transaction no longer builds indexes, and the indexes of the tables without a model start building
when the adapter is created.
