---
'mongozod': patch
---

The JSDoc says what surprises a team leaving Mongoose: `aggregate` takes no `context` and no group
hooks, so a multi-tenant or soft delete plugin does not filter it; the refinements of the whole
document do not run on updates; a replacement without `createdAt` stamps now; one invalid document
rejects a batch with `ordered: false` too; `ReadOf` types a read; and `mz.update` does not declare
the fields of `timestamps`.
