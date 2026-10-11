import type { Document } from 'mongodb'

import { isPlainObject } from '../utils/is-plain-object'

/** An object with operators, as opposed to a value to compare with. */
function isOperators(value: unknown): value is Document {
  return isPlainObject(value) && Object.keys(value).some((key) => key.startsWith('$'))
}

/**
 * The values a filter fixes, path by path, which MongoDB 8.2 copies into the document an upsert
 * inserts: an equality, `$eq`, a `$in` with one value, and the same inside `$and` or an `$or` with
 * one filter.
 */
export function filterEqualities(filter: Document): Map<string, unknown> {
  const equalities = new Map<string, unknown>()

  for (const [key, condition] of Object.entries(filter)) {
    if (key === '$and' || key === '$or') {
      const parts: unknown[] = Array.isArray(condition) ? condition : []

      if (key === '$or' && parts.length !== 1) continue

      for (const part of parts.filter(isPlainObject)) {
        for (const [path, value] of filterEqualities(part)) equalities.set(path, value)
      }
    } else if (!key.startsWith('$')) {
      if (!isOperators(condition)) equalities.set(key, condition)
      else if ('$eq' in condition) equalities.set(key, condition.$eq)
      else if (Array.isArray(condition.$in) && condition.$in.length === 1)
        equalities.set(key, condition.$in[0])
    }
  }

  return equalities
}

/** The value an update operator writes into the document an upsert inserts, as MongoDB 8.2 does. */
function created(operator: string, value: unknown): { value: unknown } | undefined {
  switch (operator) {
    case '$inc':
    case '$max':
    case '$min':
    case '$set':
    case '$setOnInsert':
      return { value }

    case '$addToSet':
    case '$push':
      return { value: isPlainObject(value) && '$each' in value ? value.$each : [value] }

    case '$currentDate':
      return { value: new Date() }

    case '$bit':
    case '$mul':
      return { value: 0 }

    // $pop, $pull, $pullAll, $rename and $unset create nothing.
    default:
      return undefined
  }
}

function setPath(document: Document, path: string, value: unknown) {
  const segments = path.split('.')
  const last = segments.pop() ?? path
  let node = document

  for (const segment of segments) {
    const child: unknown = node[segment]

    if (!isPlainObject(child)) node[segment] = {}

    node = node[segment]
  }

  node[last] = value
}

/** Whether a path names array elements with `$`, `$[]` or `$[id]`. */
function isPositional(path: string) {
  return path.split('.').some((segment) => segment.startsWith('$'))
}

/**
 * The document an upsert would insert, as MongoDB 8.2 builds it: the equalities of the filter, then
 * what each operator creates. Positional paths are left out.
 */
export function insertedDocument(filter: Document, update: Document): Document {
  const document: Document = {}

  for (const [path, value] of filterEqualities(filter)) setPath(document, path, value)

  for (const [operator, fields] of Object.entries(update)) {
    if (!isPlainObject(fields)) continue

    for (const [path, value] of Object.entries(fields)) {
      const write = isPositional(path) ? undefined : created(operator, value)

      if (write) setPath(document, path, write.value)
    }
  }

  return document
}

/**
 * The paths a filter and an update decide in the document an upsert inserts: a default on them, or
 * on a parent or a child of them, would conflict. A positional path decides its array.
 */
export function decidedPaths(filter: Document, update: Document): string[] {
  const paths = [...filterEqualities(filter).keys()]

  for (const [operator, fields] of Object.entries(update)) {
    if (!isPlainObject(fields)) continue

    for (const [path, value] of Object.entries(fields)) {
      const segments = path.split('.')
      const positional = segments.findIndex((segment) => segment.startsWith('$'))

      paths.push(positional === -1 ? path : segments.slice(0, positional).join('.'))

      if (operator === '$rename' && typeof value === 'string') paths.push(value)
    }
  }

  return paths
}

/**
 * The defaults of a parsed document that no decided path touches, by dotted path, to write with
 * `$setOnInsert`. A parent of a decided path is entered, so its other fields still get theirs.
 */
export function insertDefaults(
  document: Document,
  decided: readonly string[],
  prefix = ''
): Document {
  const defaults: Document = {}

  for (const [key, value] of Object.entries(document)) {
    const path = `${prefix}${key}`

    if (decided.some((other) => path === other || path.startsWith(`${other}.`))) continue

    if (decided.some((other) => other.startsWith(`${path}.`))) {
      if (isPlainObject(value)) Object.assign(defaults, insertDefaults(value, decided, `${path}.`))
      continue
    }

    defaults[path] = value
  }

  return defaults
}
