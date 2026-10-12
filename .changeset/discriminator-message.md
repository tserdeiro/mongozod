---
'mongozod': patch
---

An update of a discriminator says that it is the discriminator of its object, to change with a
replacement: it said that the update changed the type of the object, which is not so for a value of
a `z.enum` discriminator in the same type.
