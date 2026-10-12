---
'mongozod': patch
---

The message of a projection whose value is a number, as the `0` of one kept in a variable, says to
type it as `0 | 1` or declare it with `as const`, also for a virtual, and it no longer shows up
while a nested sub-projection is being written, where the editor suggested the methods of `String`.
