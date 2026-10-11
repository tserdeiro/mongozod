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
 *   import * as mz from 'mongozod/mz'
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
export { cursor } from './mz/cursor'
export { filter } from './mz/filter'
export { populate } from './mz/populate'
export { projection } from './mz/projection'
export { sort } from './mz/sort'
export { update } from './mz/update'
