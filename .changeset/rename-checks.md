---
'mongozod': patch
---

`$rename` compiles only toward a field that stores the type it moves, since the server moves the
stored value without parsing it: a string toward a date field no longer compiles. A `$rename`
toward a field that `timestamps` sets does not compile and throws a `ZodError`, like any other
write of it.
