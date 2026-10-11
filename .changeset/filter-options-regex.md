---
'mongozod': patch
---

`mz.filter` rejects an `$options` without `$regex`, which MongoDB rejects with the code 2.
