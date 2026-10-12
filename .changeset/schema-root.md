---
'mongozod': patch
---

A schema that is not a `z.object` or a `z.discriminatedUnion` of objects, such as a document with a
`.transform()`, throws an `Error` when the model is defined, as its types already reject it: the
inserts ran the transform and the updates, which write paths, failed. A field computed from others
goes in `.overwrite()`, which keeps the object.
