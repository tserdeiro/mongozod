import { z } from 'zod'

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
 *   ;```ts
 *   import { date } from 'mongozod/codecs/date'
 *
 *   const noteSchema = z.object({ createdAt: date(), scheduledFor: date().optional() })
 *   ```
 */
export function date() {
  // The codec goes first: with the `Date` first, `z.encode` would return it unchanged.
  return z.union([isoToDate, z.date()], {
    error: 'Invalid date: expected a Date or an ISO datetime string with Z or an offset'
  })
}
