---
'mongozod': patch
---

The `Error` of a schema that is not a document names what it is, such as a `z.optional()` or a
`z.union()`, and suggests `.overwrite()` only for a transform.
