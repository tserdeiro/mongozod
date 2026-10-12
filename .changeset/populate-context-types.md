---
'mongozod': patch
---

A read whose `populate` reads a model with plugins that ask for a context in their reads requires
that `context`, also for nested `populate`, and the editor suggests its keys: it compiled and threw
a `ZodError` at `["context"]`, or did not take the `context` when the model itself has no such
plugin.
