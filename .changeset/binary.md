---
'mongozod': minor
---

Add `mz.binary()`, from `mongozod/mzod`: a binary field that takes the base64 string of its bytes,
as a JSON client sends it, a `Uint8Array` or a `Buffer`, or a `Binary`, and returns a `Binary`, the
type the driver reads binary data as, so a document read can be written back. A `Binary` keeps its
subtype; the others become a generic one. `z.encode` turns it back into base64, and the
`$jsonSchema` of `sync()` checks it as `binData`.
