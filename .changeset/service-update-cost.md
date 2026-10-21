---
'mongozod': patch
---

A service that passes a filter and an update to the model costs far less to type check. The update's check now reads only the options it depends on, so a service whose options differ from the model's call only in others, such as `returnDocument`, no longer makes TypeScript compare two checks of the update: about 7,000 type instantiations instead of 82,000. A service that passes `FindOptionsOf` to `find` or `findOne` costs about 4,000 instead of 104,000. `UpdateMethod<M, O>` types a method that passes its own options, such as `{ returnDocument: 'after' }`.
