/**
 * The builders of endpoint inputs: Zod schemas whose values are MongoDB syntax, restricted to what
 * each endpoint declares. They nest in `z.object` like any other schema, and they never import the
 * driver, so the validation schemas that use them also run in web and native clients.
 *
 * Import them as a namespace, like Zod: a bundler keeps only the builders a client uses.
 *
 * @module
 *
 * @example
 *   ;```ts
 *   import * as mz from 'mongozod/mzod'
 *   import { z } from 'zod'
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
