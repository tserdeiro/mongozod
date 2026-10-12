---
'mongozod': patch
---

A `.map()`, `.filter()` or `.find()` over what a read returns no longer makes TypeScript compute the
variance of Zod's classes or of the model: with virtuals, `populate` or `DocOf`, one of them cost
from 90,000 to 150,000 type instantiations, and a typical project with three went from 272,784 to
65,138, and from 0.23 s to 0.06 s of check time with TypeScript 7.
