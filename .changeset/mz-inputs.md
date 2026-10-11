---
'mongozod': minor
---

Add `mz`, from `mongozod/mzod`: builders of endpoint inputs, which are Zod schemas whose values are
MongoDB syntax restricted to what each endpoint declares. `mz.filter` takes the operators each
field declares, `$elemMatch` included; `mz.update` takes `$set`, `$unset` and `$inc` on the paths
each one declares; `mz.sort` and `mz.projection` take a mask of paths, like `.pick()`; `mz.after`
turns the last document of a page into the filter of the next one; and `mz.populate` takes the
references a client can expand, each with a whitelist of fields. Each value is parsed with the
schema of its field, without its default, and `undefined` keys are dropped. The project decides
with Zod what an absent input means, such as `.default({})` or `.required({ _id: true })`. The
subpath never imports the driver, so validation schemas also run in web and native clients.
