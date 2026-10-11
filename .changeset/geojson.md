---
'mongozod': minor
---

Add GeoJSON to `mongozod/mzod`: `mz.point()`, `mz.lineString()`, `mz.polygon()`, `mz.multiPoint()`,
`mz.multiLineString()` and `mz.multiPolygon()`, Zod schemas of the GeoJSON MongoDB stores and queries. They check what MongoDB
checks with a `2dsphere` index and stores without one: `[longitude, latitude]` in their ranges, a
line with two different positions, and closed rings of four positions at least. They import only
Zod, so they also run in web and native clients.
