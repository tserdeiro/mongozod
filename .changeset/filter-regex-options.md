---
'mongozod': patch
---

The `$options` of `mz.filter` takes only the flags MongoDB takes, `i`, `m`, `x`, `s` and `u`: any other reached the server, which rejects it with the code 51108.
