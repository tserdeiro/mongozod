---
'mongozod': patch
---

`UpdateOf` works with a model that has `timestamps` and references or plugins: it took the model's
timestamps by inferring the whole model, which failed on those, so a service that passed an update
to such a model did not compile. The model now carries them in an optional `~timestamps`
property, which only exists in its types.
