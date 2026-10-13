import type { Document } from 'mongodb'

/**
 * Sets a field of an object as an own property. A key such as `__proto__` is a field name, as
 * MongoDB stores it: assigning it would change the object's prototype instead.
 */
export function setField(object: Document, key: string, value: unknown) {
  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  })
}
