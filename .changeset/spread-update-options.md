---
'mongozod': patch
---

A function can spread the options it takes as `UpdateOptionsArg<typeof Model>` into an update of the
model: the check of `arrayFilters` walked the array of those options as an object, and it failed
with `"toString" is not an identifier of the update`.
