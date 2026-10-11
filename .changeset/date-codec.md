---
'mongozod': minor
---

Add `mz.date()`, from `mongozod/mzod`: a date field that takes a `Date` or an ISO datetime
string with `Z` or an offset, as a JSON client sends it, and returns a `Date`. `z.encode` turns it
back into an ISO string in UTC, and the `$jsonSchema` of `sync()` checks it as a `date`. It imports
only Zod, so it also runs in web and native clients.
