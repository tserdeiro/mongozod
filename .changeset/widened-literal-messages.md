---
'mongozod': patch
---

An update or a sort kept in a variable, whose literals TypeScript widens, says why it does not compile: `"nextRunAt" is a string: $unset takes '', 1 or true, so declare the update with as const`, and the same for `$currentDate`, `$pop` and a sort, as a projection already did.
