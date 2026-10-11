---
'mongozod': patch
---

Fix the JSDoc examples: they no longer start with a `;` that the editor showed, the one of
`mz.objectId()` compiles, the one of `find` populates with a `projection`, the one of
`softDelete()` declares `deletedAt`, and `mongozod()` shows a transaction. The JSDoc of `find` says
that the filter is checked by its types only.
