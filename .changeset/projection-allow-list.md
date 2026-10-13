---
'mongozod': minor
---

`mz.projection` always returns an inclusion of the paths its mask declares, so a client never gets a field the mask leaves out. MongoDB reads an exclusion such as `{ title: 0 }`, and `{}`, as the whole document: now an exclusion means the declared paths but those, and `{}` means all of them. Each included path is `1`. A mask with a path and a path inside it throws, because MongoDB rejects both in one projection. Declare it with `.prefault({})` so a missing projection also stays within the mask.
