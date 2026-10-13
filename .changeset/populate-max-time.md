---
'mongozod': patch
---

The queries of `populate` take the `maxTimeMS` and the `signal` of the read that asks for them, as they take its session: the limit of a read bounds each of its queries, not only the first one.
