import type { CleanedWhere } from 'better-auth/adapters'
import type { Document } from 'mongodb'

/** What the translation of a `where` knows about the fields of a table. */
export interface WhereFields {
  /** Whether the field holds ids: the id or a reference to one. */
  holdsId(field: string): boolean
  /** The stored name of a field: its `fieldName`, or `_id` for the id. */
  name(field: string): string
  /** The stored form of an id, as `ObjectId` or `UUID` unless the app generates the ids. */
  storeId(value: unknown): unknown
}

/** The longest value a pattern takes, as the official adapter, which cuts the rest. */
const MAX_PATTERN_LENGTH = 256

/** The value with the special characters of a regular expression escaped. */
function escape(value: unknown): string {
  if (typeof value !== 'string') return ''

  return value.slice(0, MAX_PATTERN_LENGTH).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The pattern of a value from start to end. */
function exactly(value: unknown) {
  return `^${escape(value)}$`
}

function regex(field: string, pattern: string, insensitive: boolean): Document {
  return { [field]: insensitive ? { $options: 'i', $regex: pattern } : { $regex: pattern } }
}

/** One condition of a `where`, as the official adapter translates it. */
function condition(where: CleanedWhere, fields: WhereFields): Document {
  const field = fields.name(where.field)
  const { value } = where
  const holdsId = fields.holdsId(where.field)
  const store = (item: unknown) => (holdsId ? fields.storeId(item) : item)
  const values = Array.isArray(value) ? value : [value]
  const strings = values.every((item) => typeof item === 'string')
  // Ids compare exactly, whatever the mode.
  const insensitive = !holdsId && where.mode === 'insensitive' && strings

  switch (where.operator ?? 'eq') {
    case 'eq':
      return insensitive && typeof value === 'string'
        ? regex(field, exactly(value), true)
        : { [field]: store(value) }
    case 'ne':
      return insensitive && typeof value === 'string'
        ? { [field]: { $not: { $options: 'i', $regex: exactly(value) } } }
        : { [field]: { $ne: store(value) } }
    case 'in':
      if (insensitive && Array.isArray(value)) {
        // An empty `$or` is an error, and an empty `in` matches nothing.
        if (value.length === 0) return { $expr: { $eq: [1, 0] } }

        return { $or: value.map((item) => regex(field, exactly(item), true)) }
      }

      return { [field]: { $in: values.map(store) } }
    case 'not_in':
      if (insensitive && Array.isArray(value)) {
        if (value.length === 0) return {}

        return { $nor: value.map((item) => regex(field, exactly(item), true)) }
      }

      return { [field]: { $nin: values.map(store) } }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return { [field]: { [`$${where.operator}`]: store(value) } }
    case 'contains':
      return regex(field, `.*${escape(value)}.*`, insensitive)
    case 'starts_with':
      return regex(field, `^${escape(value)}`, insensitive)
    case 'ends_with':
      return regex(field, `${escape(value)}$`, insensitive)
    default:
      throw new Error(`Unsupported operator: ${String(where.operator)}`)
  }
}

/**
 * The MongoDB filter of a Better Auth `where`, as the official adapter builds it: one condition
 * alone, and several with the `AND` ones in an `$and` and the `OR` ones in an `$or`, both in the
 * same filter.
 */
export function toFilter(where: readonly CleanedWhere[] = [], fields: WhereFields): Document {
  const [first] = where

  if (!first) return {}
  if (where.length === 1) return condition(first, fields)

  const and = where
    .filter((item) => item.connector === 'AND')
    .map((item) => condition(item, fields))
  const or = where.filter((item) => item.connector === 'OR').map((item) => condition(item, fields))
  const filter: Document = {}

  if (and.length > 0) filter.$and = and
  if (or.length > 0) filter.$or = or

  return filter
}
