/**
 * Why a key with a `.` or starting with `$` cannot be written, which no path reaches, or
 * `undefined` for a key a path reaches. The model checks what it writes with it, and `mz.update`
 * the values it parses, so that the client gets the error instead of the write. It imports
 * nothing, so `mongozod/mzod` stays free of the driver.
 */
export function unreachableKey(key: string): string | undefined {
  if (!key.includes('.') && !key.startsWith('$')) return undefined

  return `"${key}" cannot be a key: no path reaches a key with a "." or starting with "$"`
}

/** A key no path reaches, found in a value, with its path and why. */
export interface UnreachableKey {
  message: string
  path: PropertyKey[]
}

/**
 * The first key of a value that no path reaches, at any level, or `undefined`. It stops at the
 * first one: one issue rejects the value, and a client could send thousands, which would overflow
 * the arguments Zod spreads its issues with. It goes through arrays and plain objects only, as
 * `written()` does: a BSON value, such as the `Binary` of `mz.binary()`, is a value, and walking
 * its bytes would cost a client's request what the bytes weigh.
 */
export function firstUnreachableKey(
  value: unknown,
  path: PropertyKey[] = []
): UnreachableKey | undefined {
  if (Array.isArray(value)) {
    for (const [index, element] of value.entries()) {
      const found = firstUnreachableKey(element, [...path, index])

      if (found) return found
    }

    return undefined
  }

  if (typeof value !== 'object' || value === null) return undefined

  const prototype: unknown = Object.getPrototypeOf(value)

  if (prototype !== Object.prototype && prototype !== null) return undefined

  for (const [key, field] of Object.entries(value)) {
    const message = unreachableKey(key)

    if (message) return { message, path: [...path, key] }

    const found = firstUnreachableKey(field, [...path, key])

    if (found) return found
  }

  return undefined
}
