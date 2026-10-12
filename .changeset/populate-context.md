---
'mongozod': patch
---

`populate` forwards the `context` of the read to the reads of the referenced models, as it does
with the `session`, so a plugin that asks for a context in the reads of the target, such as a
multi-tenant one, gets it: it threw a `ZodError` at `["context"]` on every read that populated it.
