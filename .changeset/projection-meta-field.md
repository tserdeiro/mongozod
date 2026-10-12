---
'mongozod': patch
---

`{ $meta: 'textScore' }` on a field of the document types it as the `number` of the score, which
replaces its value as in MongoDB: it was `never`. On a dotted path it does not compile, because
MongoDB puts the score inside the object, and the type had a key with a dot.
