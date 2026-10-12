---
'mongozod': patch
---

`mz.decimal128()` rejects `NaN` and `Infinity` in any of its forms, which bson takes: since `$inc`
left out the checks of the field, a `$inc` of `'NaN'` stored one. A `NaN` already stored is still
read, and a `$set` fixes it, but a replacement with the document as read throws a `ZodError`. The
amount of `$inc` and `$mul` on a decimal that also takes `null` leaves out the checks of each option
of the union, and takes no `null`.
