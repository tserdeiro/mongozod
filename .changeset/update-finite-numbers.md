---
'mongozod': patch
---

`$inc` and `$mul` reject `Infinity` and `NaN`, which the server stores and no `z.number()` takes back.
