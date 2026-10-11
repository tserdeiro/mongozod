/**
 * The Zod of MongoDB: what Zod does not bring for MongoDB, in one namespace. Import it as one,
 * like Zod, so a bundler keeps only what a client uses:
 *
 * - **Field types** for a document's schema: `objectId()`, `decimal128()`, `binary()`, `date()` and
 *   GeoJSON, which take what a JSON client sends and return the BSON value.
 * - **Builders of endpoint inputs**, from a document's schema: `filter`, `update`, `sort`,
 *   `projection`, `cursor` and `populate`, MongoDB syntax restricted to what each endpoint
 *   declares.
 *
 * It never imports the driver, so the schemas that use it also run in web and native clients. It
 * imports `bson`, a peer dependency, which a bundler leaves out unless a field needs it.
 *
 * @module
 *
 * @example
 *   ;```ts
 *   import * as mz from 'mongozod/mzod'
 *   import { z } from 'zod'
 *
 *   const brandSchema = z.object({ _id: mz.objectId(), name: z.string(), createdAt: mz.date() })
 *
 *   export const listBrandsSchema = z.object({
 *     cursor: mz.cursor(brandSchema, { createdAt: -1, _id: -1 }).default({}),
 *     filter: mz
 *       .filter(brandSchema, { _id: ['$eq', '$in'], name: ['$eq', '$exists'] })
 *       .default({}),
 *     limit: z.number().int().min(1).max(100).default(20)
 *   })
 *   ```
 */
export { cursor } from './mzod/cursor'
export { filter } from './mzod/filter'
export { populate } from './mzod/populate'
export { projection } from './mzod/projection'
export { sort } from './mzod/sort'
export { update } from './mzod/update'
export { binary, decimal128, objectId } from './mzod/fields/bson'
export { date } from './mzod/fields/date'
export {
  geometryCollection,
  lineString,
  multiLineString,
  multiPoint,
  multiPolygon,
  point,
  polygon
} from './mzod/fields/geojson'
