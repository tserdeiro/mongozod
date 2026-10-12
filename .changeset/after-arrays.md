---
'mongozod': patch
---

`mz.after` rejects a field that stores an array, in its types and when it is declared: MongoDB
sorts an array by one of its elements and a range matches it when any element passes, so the pages
repeated and skipped documents.
