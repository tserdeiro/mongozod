---
'mongozod': minor
---

The official `autoIndex` plugin, in `mongozod/plugins/auto-index`, creates the indexes a model declares on its first operation in each database, as Mongoose's `autoIndex` does, for development, tests and serverless platforms. A model exposes the indexes it declares in `indexes`, and `AnyModel` adds `indexes` and a `collection` with `createIndexes`. The Sync guide says when to run `sync()`.
