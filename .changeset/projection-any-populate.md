---
'mongozod': patch
---

A projection typed as the driver's `Document` compiles with `populate` too, in the options and in
`.project()`, and a value typed `any` next to an inclusion no longer says that the projection mixes
inclusion and exclusion.
