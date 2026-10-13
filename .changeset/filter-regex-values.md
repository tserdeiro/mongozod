---
'mongozod': patch
---

`mz.filter` and `mz.after` reject a `RegExp` or a `BSONRegExp` as a value, which MongoDB matches as a pattern where the endpoint declared an equality: a transport such as superjson sends one, and a transform can build one. A pattern enters through a declared `$regex` only.
