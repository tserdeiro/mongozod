---
'mongozod': patch
---

The JSDoc of `mz.projection` warns against `.default({})`, which Zod returns without parsing, and no longer against `.optional()`, which runs the builder's default since Zod 4.5.
