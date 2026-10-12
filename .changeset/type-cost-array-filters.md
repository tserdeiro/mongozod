---
'mongozod': patch
---

Lower the type cost of updates with `arrayFilters`: an array of them is no longer intersected with
the driver's `Document[]`, and each entry is checked to be a document.
