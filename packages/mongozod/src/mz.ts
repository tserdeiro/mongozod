import { cursor } from './mz/cursor'
import { filter } from './mz/filter'
import { populate } from './mz/populate'
import { projection } from './mz/projection'
import { sort } from './mz/sort'
import { update } from './mz/update'

/**
 * The builders of endpoint inputs: Zod schemas whose values are MongoDB syntax, restricted to what
 * each endpoint declares. They nest in `z.object` like any other schema, and they never import the
 * driver, so the validation schemas that use them also run in web and native clients.
 *
 * @example
 *   ;```ts
 *   import { mz } from 'mongozod/mz'
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
export const mz = { cursor, filter, populate, projection, sort, update }
