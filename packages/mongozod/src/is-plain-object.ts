import type { Document } from 'mongodb'

/** An object literal, as opposed to an array, a `Date`, an `ObjectId` or another class instance. */
export function isPlainObject(value: unknown): value is Document {
  if (typeof value !== 'object' || value === null) return false

  const prototype: unknown = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}
