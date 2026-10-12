---
'mongozod': minor
---

`find`, `findOne`, `.project()`, the `filter` of `populate` and `ReadOf` type the documents of a
discriminated union as the types their filter allows, with the rule of the updates: an equality,
`$eq` or `$in` on the discriminator, at the top level or inside `$and`. `find({ kind: 'click' })`
returns clicks, as a discriminator model does in Mongoose.
