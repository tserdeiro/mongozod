import { z } from 'zod'

/**
 * A position: `[longitude, latitude]`, in that order, as MongoDB and GeoJSON (RFC 7946) take it,
 * with an optional altitude. MongoDB rejects the ranges out of a `2dsphere` index, and without one
 * it stores them.
 */
const position = z.tuple([
  z
    .number()
    .min(-180, 'longitude goes from -180 to 180')
    .max(180, 'longitude goes from -180 to 180'),
  z.number().min(-90, 'latitude goes from -90 to 90').max(90, 'latitude goes from -90 to 90'),
  z.number().optional()
])

type Position = z.output<typeof position>

function samePosition(a: Position, b: Position) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

/** The positions of a line: two different ones at least, or MongoDB rejects it as degenerate. */
const linePositions = z
  .array(position)
  .refine(
    ([first, ...rest]) => first !== undefined && rest.some((each) => !samePosition(first, each)),
    'a line has 2 different positions at least'
  )

/** A linear ring: closed, with its last position repeating the first, and 4 positions at least. */
const ring = z
  .array(position)
  .min(4, 'a ring has 4 positions at least, the last repeating the first')
  .refine((positions) => {
    const [first] = positions
    const last = positions.at(-1)

    return first !== undefined && last !== undefined && samePosition(first, last)
  }, 'a ring is closed: its last position repeats the first')

/** The rings of a polygon: the exterior one first, then its holes. */
const rings = z.array(ring).min(1, 'a polygon has its exterior ring')

/**
 * A GeoJSON `Point`, as MongoDB stores and queries it, with its `[longitude, latitude]` as its
 * coordinates.
 *
 * @example
 *   import * as mz from 'mongozod/mzod'
 *
 *   const storeSchema = z.object({ name: z.string(), location: mz.point() })
 *   // { name: 'Centro', location: { type: 'Point', coordinates: [-58.38, -34.6] } }
 */
export function point() {
  return z.object({ coordinates: position, type: z.literal('Point') })
}

/** A GeoJSON `LineString`: two different positions at least. */
export function lineString() {
  return z.object({ coordinates: linePositions, type: z.literal('LineString') })
}

/**
 * A GeoJSON `Polygon`: its exterior ring, then its holes, each closed and with 4 positions at
 * least. That a ring does not cross itself, and that a hole is inside the exterior ring, MongoDB
 * checks with a `2dsphere` index.
 */
export function polygon() {
  return z.object({ coordinates: rings, type: z.literal('Polygon') })
}

/** A GeoJSON `MultiPoint`: one position at least. MongoDB queries it with a `2dsphere` index. */
export function multiPoint() {
  return z.object({
    coordinates: z.array(position).min(1, 'a MultiPoint has 1 position at least'),
    type: z.literal('MultiPoint')
  })
}

/** A GeoJSON `MultiLineString`: one line at least. MongoDB queries it with a `2dsphere` index. */
export function multiLineString() {
  return z.object({
    coordinates: z.array(linePositions).min(1, 'a MultiLineString has 1 line at least'),
    type: z.literal('MultiLineString')
  })
}

/** A GeoJSON `MultiPolygon`: one polygon at least. MongoDB queries it with a `2dsphere` index. */
export function multiPolygon() {
  return z.object({
    coordinates: z.array(rings).min(1, 'a MultiPolygon has 1 polygon at least'),
    type: z.literal('MultiPolygon')
  })
}

/**
 * A GeoJSON `GeometryCollection`: one geometry at least, of the types above. MongoDB rejects an
 * empty one and one inside another, which RFC 7946 also advises against.
 */
export function geometryCollection() {
  const geometry = z.discriminatedUnion('type', [
    point(),
    lineString(),
    polygon(),
    multiPoint(),
    multiLineString(),
    multiPolygon()
  ])

  return z.object({
    geometries: z.array(geometry).min(1, 'a GeometryCollection has 1 geometry at least'),
    type: z.literal('GeometryCollection')
  })
}
