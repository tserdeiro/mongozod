---
'mongozod': patch
---

A model whose `plugins` are typed as `Plugin[]` takes its inserts with their required fields: the
type said the plugins could fill any field, so every field was optional and an insert without them
compiled.
