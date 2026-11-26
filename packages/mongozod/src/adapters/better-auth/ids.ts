import type { BetterAuthOptions } from 'better-auth'

import { BSON, ObjectId, UUID } from 'mongodb'

/** How the adapter stores ids, from `advanced.database.generateId`, as the official adapter does. */
export interface Ids {
  /** The app generates the ids, so they are stored as given. */
  custom: boolean
  /** The class of a stored id: `UUID` with `generateId: 'uuid'`, `ObjectId` otherwise. */
  isId(value: unknown): value is ObjectId | UUID
  /** The stored id of a string, or `undefined` when it is not one. */
  parse(value: string): ObjectId | UUID | undefined
  /** A new stored id. */
  generate(): ObjectId | UUID
}

/** The ids of a Better Auth instance. */
export function idsOf(options: BetterAuthOptions): Ids {
  const generateId = options.advanced?.database?.generateId
  const uuid = generateId === 'uuid'

  return {
    custom: typeof generateId === 'function',
    generate: () => (uuid ? new UUID() : new ObjectId()),
    isId(value): value is ObjectId | UUID {
      return uuid ? value instanceof UUID : value instanceof ObjectId
    },
    parse(value) {
      // As the official adapter: what the constructor takes is an id, and the rest stays a string.
      try {
        return uuid ? new UUID(value) : new ObjectId(value)
      } catch (error) {
        if (BSON.BSONError.isBSONError(error)) return undefined

        throw error
      }
    }
  }
}

/** The string of a stored id, which Better Auth reads, and any other value as it is. */
export function idToString(value: unknown): unknown {
  if (value instanceof UUID) return value.toString()
  if (value instanceof ObjectId) return value.toHexString()

  return value
}
