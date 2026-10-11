---
'mongozod': minor
---

A reference with a `localField` and no `foreignField` populates, in a key that is not stored, the
document whose `_id` the `localField` stores, which stays as it is: `capital` from `capitalId`. Its
value follows what the `localField` stores: a document, or `null` when it is missing, for one id,
and an array for an array of ids or a path through an array. It takes the options of the other
references.
