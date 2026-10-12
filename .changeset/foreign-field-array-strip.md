---
'mongozod': patch
---

A one-to-many `populate` whose `foreignField` is inside an array of objects, with a projection that
includes other fields, leaves out the array: it left one of empty objects, such as
`refs: [{}, {}]`, which the type does not have.
