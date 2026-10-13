---
'mongozod': patch
---

The model throws a `ZodError` when a filter has an `undefined` value, at any level: the driver sends it as `null`, which matches the documents without the field, so `findOne({ email, resetToken: body.token })` with a body without a token matched the users without one. The types already rejected it, and a value typed `any` compiled.
