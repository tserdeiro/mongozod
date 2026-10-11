---
'mongozod': minor
---

Add GeoJSON to `mongozod/mzod`: `mz.point()`, `mz.lineString()`, `mz.polygon()`, `mz.multiPoint()`,
`mz.multiLineString()`, `mz.multiPolygon()` and `mz.geometryCollection()`, Zod schemas of the GeoJSON MongoDB stores and queries. They check what MongoDB
checks with a `2dsphere` index and stores without one: `[longitude, latitude]` in their ranges, a
line with two different positions, closed rings of four positions at least, and a collection that
is neither empty nor nested. They import only
Zod, so they also run in web and native clients.
