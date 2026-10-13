---
'mongozod': patch
---

`mz.projection` gives the mask when the client sends no projection, so its key is optional in an input and `.prefault({})` is no longer needed. A model without a projection reads the whole document, with the fields the mask leaves out. Don't wrap it in `.optional()`, which skips the builder.
