---
'mongozod': minor
---

Add `mz.literal()`, a field whose keys MongoDB doesn't interpret: a key such as `$schema` or `a.b`
is stored as data, so a JSON Schema or a spec with `$` expressions can be stored. `mz.filter` and
`mz.update` still reject these keys in what a client sends.
