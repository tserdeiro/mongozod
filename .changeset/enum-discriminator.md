---
'mongozod': patch
---

A type of document whose discriminator is a `z.enum` is allowed when the filter fixes one of its
values, in the types of reads and updates, as the runtime already did: `find({ type: 'view' })`
typed `never[]`, `$in` over two types typed only one of them, and an update of the type did not
compile.
