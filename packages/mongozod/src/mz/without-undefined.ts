/**
 * The object without its `undefined` keys. JSON never sends them and superjson does, so dropping
 * them makes a request mean the same with both; the driver would send them as `null`.
 */
export function withoutUndefined<T extends object>(object: T): T {
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined) Reflect.deleteProperty(object, key)
  }

  return object
}
