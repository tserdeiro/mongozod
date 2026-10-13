import type { Document } from 'mongodb'
import type * as core from 'zod/v4/core'

import { isPlainObject } from '../utils/is-plain-object'
import { setField } from '../utils/set-field'
import { valueKey } from '../utils/value-key'

/** An object with operators, as opposed to a value to compare with. */
function isOperators(value: unknown): value is Document {
  return isPlainObject(value) && Object.keys(value).some((key) => key.startsWith('$'))
}

/** A regular expression, of JavaScript or of bson, which a filter matches instead of comparing. */
function isRegExp(value: unknown) {
  return (
    value instanceof RegExp ||
    (typeof value === 'object' &&
      value !== null &&
      '_bsontype' in value &&
      value._bsontype === 'BSONRegExp')
  )
}

/**
 * The values a filter fixes, path by path, which MongoDB 8.2 copies into the document an upsert
 * inserts: an equality, `$eq`, a `$in` with one value, and the same inside `$and` or an `$or` with
 * one filter. A regular expression matches, so it is not copied, unless it is the value of `$eq`;
 * an `undefined` is copied as the `null` the driver sends.
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
      if (!isOperators(condition)) {
        if (!isRegExp(condition)) equalities.set(key, condition ?? null)
      } else if ('$eq' in condition) {
        equalities.set(key, condition.$eq ?? null)
      } else if (
        Array.isArray(condition.$in) &&
        condition.$in.length === 1 &&
        !isRegExp(condition.$in[0])
      ) {
        equalities.set(key, condition.$in[0] ?? null)
      }
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

/** Writes a value at a dotted path through own fields only, so `__proto__` is a field name too. */
function setPath(document: Document, path: string, value: unknown) {
  const segments = path.split('.')
  const last = segments.pop() ?? path
  let node = document

  for (const segment of segments) {
    const child: unknown = Object.hasOwn(node, segment) ? node[segment] : undefined
    const next = isPlainObject(child) ? child : {}

    setField(node, segment, next)
    node = next
  }

  setField(node, last, value)
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

/**
 * The issue of an upsert whose filter fixes the `_id` to `null`, or to an `undefined` that the
 * driver sends as `null`: the server would insert a document whose `_id` is `null`.
 */
export function nullIdIssue(filter: Document): core.$ZodIssue | undefined {
  if (filterEqualities(filter).get('_id') !== null) return undefined

  return {
    code: 'custom',
    input: filter,
    message: 'an upsert whose filter has a null _id would insert a document with a null _id',
    path: ['_id']
  }
}

/** The value at a dotted path of a document, through its own fields. */
function valueAt(document: Document, path: string): unknown {
  let value: unknown = document

  for (const segment of path.split('.')) {
    value = isPlainObject(value) && Object.hasOwn(value, segment) ? value[segment] : undefined
  }

  return value
}

/**
 * The issues of the values a filter fixes that the schema stores differently, such as an email
 * that a transform lowercases or an object that lacks a default: the server copies the filter's
 * value as it is, so the document it inserts would not be the one validated. A path that the
 * update also writes is skipped, since the update decides it.
 */
export function storedAsFilteredIssues(
  filter: Document,
  update: Document,
  parsed: Document
): core.$ZodIssue[] {
  const written = Object.values(update)
    .filter(isPlainObject)
    .flatMap((fields) => Object.keys(fields))
  const issues: core.$ZodIssue[] = []

  for (const [path, value] of filterEqualities(filter)) {
    const overlaps = written.some(
      (other) => other === path || other.startsWith(`${path}.`) || path.startsWith(`${other}.`)
    )

    if (!overlaps && valueKey(value) !== valueKey(valueAt(parsed, path))) {
      issues.push({
        code: 'custom',
        input: value,
        message: `the upsert would insert the filter's "${path}" as it is, which the schema stores differently: filter by the value the schema stores`,
        path: path.split('.')
      })
    }
  }

  return issues
}
