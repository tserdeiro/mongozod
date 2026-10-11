---
'mongozod': minor
---

`populate` takes a nested `populate` in the options of each reference: the referenced model
populates its own references, in as many levels as asked, with its plugins and virtuals. It is
checked against the references of the target model, and the type of the read follows. Models
expose their `references`, like their `schema` and `virtuals`.
