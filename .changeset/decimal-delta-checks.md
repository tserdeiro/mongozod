---
'mongozod': patch
---

`$inc` and `$mul` on a `Decimal128` parse the amount with the field's schema without its checks,
in the model and in `mz.update`: a balance with a `.refine()` that keeps it positive rejected every
debit, such as `$inc: { balance: '-10' }`, because the check ran on the amount. As with numbers,
the checks apply to the value of the field, not to what changes it.
