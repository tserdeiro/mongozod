---
'mongozod': minor
---

Add `mz.uuid()`, from `mongozod/mzod`: a UUID field stored as a `Binary` of subtype 4, 16 bytes
where its string takes 36. It takes the string of a UUID, as a JSON client sends it, or a `UUID`,
and returns a `UUID`, the type the driver reads subtype 4 as, so a document read can be written
back. `z.encode` and `JSON.stringify` turn it back into the string, and the `$jsonSchema` of
`sync()` checks it as `binData`.
