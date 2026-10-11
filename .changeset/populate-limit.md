---
'mongozod': minor
---

`populate` takes a `limit` per document, not for the whole batch: it keeps the first ones of each
array of references, in its order or in the one of `sort`, and in a one-to-many reference, which
needs a `sort` with it, it makes one query per document, through the target model and its plugins.
A `limit` on a reference that stores one id does not compile.
