---
'mongozod': minor
---

Add the `softDelete` plugin, from `mongozod/plugins/soft-delete`. Reads and updates skip the
documents with `deletedAt`, and deletes mark it with an update dispatched through the model, so
`timestamps` and the other plugins see an update; `findOneAndDelete` returns the document as it
was before the mark. A filter that mentions `deletedAt`, at its top level or inside `$and`, `$or`
or `$nor`, takes over: it reads the trash, restores a document or removes it for real. `aggregate`
and `estimatedDocumentCount` see every document, and a `bulkWrite` counts the marks as the driver
reports them, as modified documents.
