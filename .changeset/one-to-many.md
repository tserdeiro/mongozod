---
'mongozod': minor
---

A reference can be one-to-many, like Mongoose's virtual populate: a key that is not a field, with
`{ model, foreignField, localField }`, the names of MongoDB's `$lookup` (`localField` is `_id`
by default). `populate` adds an array of the documents of that model whose `foreignField` stores
the `localField` of each document, with one `$in` query per batch and the options of any other
reference. The read asks for the `localField` when its projection leaves it out, and removes it.
A nested `populate` cannot take the `foreignField`, which points back to the document.
