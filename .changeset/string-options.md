---
'mongozod': patch
---

A `sort`, a `projection` or a `populate` in a string, as Mongoose takes them, does not compile, and
a `sort` or a `projection` in a string throws a `ZodError` at runtime too: the driver sorted by a
field named like the string, without a word.
