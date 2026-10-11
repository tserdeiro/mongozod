---
'mongozod': minor
---

`mongozod/mzod` is the Zod of MongoDB: besides the builders of endpoint inputs, it has the field
types, `mz.objectId()`, `mz.decimal128()`, `mz.binary()`, `mz.date()` and the GeoJSON ones, so one
`import * as mz from 'mongozod/mzod'` brings everything Zod does not have for MongoDB. A bundler
still keeps only what a client uses. `bson` becomes a required peer dependency, which npm and pnpm
install on their own.
