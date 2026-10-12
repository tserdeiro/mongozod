---
'mongozod': patch
---

A path of an update takes the positional `$` once, as MongoDB does: one with two, such as
`items.$.tags.$`, compiled and passed the validation, and the server rejected it with the code 2.
It does not compile, and throws a `ZodError`.
