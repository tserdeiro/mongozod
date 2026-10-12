import { z } from 'zod'

import { fieldError } from '../internal/field-error'

/**
 * An ISO datetime string with `Z` or an offset, as a JSON client sends it, decoded to a `Date`. One
 * without either is rejected: it does not say which instant it is.
 */
const isoToDate = z.codec(z.iso.datetime({ offset: true }), z.date(), {
  decode: (iso) => new Date(iso),
  encode: (value) => value.toISOString()
})

/**
 * A date field: it takes a `Date`, which the server passes, or an ISO datetime string with `Z` or
 * an offset, which a JSON client sends, and returns a `Date`. `z.encode` turns it back into an ISO
 * string in UTC, and the `$jsonSchema` of `sync()` checks it as a `date`.
 *
 * It is Zod's `isoDatetimeToDate` codec, in a union that also takes a `Date`. It imports only Zod,
 * so the schemas that use it also run in web and native clients.
 *
 * @example
 *   import * as mz from 'mongozod/mzod'
 *
 *   const noteSchema = z.object({ createdAt: mz.date(), scheduledFor: mz.date().optional() })
 *
 * @see https://mongozod.dev/docs/api/mzod#mzdate
 */
export function date() {
  // The codec goes first: with the `Date` first, `z.encode` would return it unchanged.
  return z.union([isoToDate, z.date()], {
    error: fieldError('Invalid date: expected a Date or an ISO datetime string with Z or an offset')
  })
}
