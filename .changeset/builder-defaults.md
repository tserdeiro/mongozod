---
'mongozod': patch
---

`mz.after` gives `{}`, the first page, when the client sends nothing, so a list no longer needs `.default({})` on it. `mz.sort` and `mz.populate` are optional, so they no longer need `.optional()`; a default sort still takes `.default()`. `mz.filter` keeps no default: a missing filter means everything in a list and has to fail in a filter by id, which each endpoint decides.
