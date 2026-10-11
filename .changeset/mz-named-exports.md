---
'mongozod': minor
---

`mongozod/mz` exports each builder by name instead of an `mz` object, so a bundler keeps only the
ones a client uses: `import * as mz from 'mongozod/mz'` keeps `mz.filter(…)` working, and
`import { filter } from 'mongozod/mz'` also works. Using only `mz.sort` now bundles 3.4 KB
instead of 14 KB.
