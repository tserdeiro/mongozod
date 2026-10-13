---
'mongozod': patch
---

An update whose path is `__proto__`, on a schema that takes any key, such as `z.looseObject()`, is written as a field, as MongoDB stores it: the model dropped it in silence.
