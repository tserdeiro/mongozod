---
'mongozod': minor
---

Method types for services: `FilterMethod`, `UpdateMethod`, `ReplaceMethod`, `BulkWriteMethod`, `AggregateMethod` and `DistinctMethod`. Given with `satisfies`, an arrow function takes the type parameters that check what it passes to the model, so a service method no longer writes them, and keeps its own result. `PipelineOf<M, P>` types a pipeline a function passes to `aggregate`.
