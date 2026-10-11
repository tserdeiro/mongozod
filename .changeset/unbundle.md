---
'mongozod': patch
---

The build emits one file per module instead of bundling each entry, so an app's bundler drops the
modules it does not use: a client that only uses `mz.sort` and `mz.date` no longer bundles `bson`.
