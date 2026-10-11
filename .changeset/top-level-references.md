---
'mongozod': patch
---

`references` throws an `Error` for a path such as `items.product`, which `populate` used to leave
untouched without a warning.
