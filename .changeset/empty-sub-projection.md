---
'mongozod': minor
---

An empty sub-projection, such as `{ meta: {} }`, does not compile: MongoDB rejects it with the
code 51270. Inside its braces, the editor suggests the fields of the object, also deeper and in an
array of objects, where it suggested none.
