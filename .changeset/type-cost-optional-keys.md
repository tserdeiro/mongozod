---
'mongozod': patch
---

Lower the type cost of projections, `populate` and filters: whether a key is optional is checked
without comparing the type of the property.
