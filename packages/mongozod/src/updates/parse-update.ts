import type { UpdateContext } from './update-path'
import type { Document } from 'mongodb'
import type * as core from 'zod/v4/core'

import { z } from 'zod'

import { safeParseWritten } from '../model/parse-document'
import { inElement, isDynamicKey, namesElement, schemaAt } from '../schema/schema-at'
import {
  elementsOf,
  isDecimal,
  isInteger,
  isNumber,
  isOptional,
  isSet,
  takes
} from '../schema/schema-kinds'
import { withoutChecks } from '../schema/without-checks'
import { isPlainObject } from '../utils/is-plain-object'

import { resolveUpdatePath } from './update-path'
import {
  decidedPaths,
  filterEqualities,
  insertDefaults,
  insertedDocument,
  nullIdIssue,
  storedAsFilteredIssues
} from './upsert'

const OPERATORS = new Set([
  '$addToSet',
  '$bit',
  '$currentDate',
  '$inc',
  '$max',
  '$min',
  '$mul',
  '$pop',
  '$pull',
  '$pullAll',
  '$push',
  '$rename',
  '$set',
  '$setOnInsert',
  '$unset'
])

/** The options of an update that change how it is validated. */
export interface ParseUpdateOptions {
  arrayFilters?: readonly Document[]
  upsert?: boolean
}

/** A path of the `_id`, which only `$setOnInsert` writes, whole: the server rejects a change (66). */
const ID_PATH = /^_id(?:\.|$)/

type FieldResult = { issues: core.$ZodIssue[] } | { value: unknown }

function fail(path: PropertyKey[], message: string, input: unknown): FieldResult {
  return { issues: [{ code: 'custom', input, message, path }] }
}

/** Parses a value with every schema it has to fit, and keeps what the first one returns. */
async function parseEvery(
  schemas: core.$ZodType[],
  value: unknown,
  at: PropertyKey[]
): Promise<FieldResult> {
  const [first, ...rest] = await Promise.all(
    schemas.map((schema) => safeParseWritten(schema, value))
  )

  for (const result of [first, ...rest]) {
    if (result && !result.success) {
      return {
        issues: result.issues.map((issue) =>
          Object.assign({}, issue, { path: [...at, ...issue.path] })
        )
      }
    }
  }

  return { value: first?.success ? first.data : undefined }
}

/** Parses a value with the first schema it fits. */
async function parseAny(
  schemas: core.$ZodType[],
  value: unknown,
  at: PropertyKey[]
): Promise<FieldResult> {
  const results = await Promise.all(schemas.map((schema) => parseEvery([schema], value, at)))

  return (
    results.find((result) => 'value' in result) ??
    results[0] ??
    fail(at, 'no type takes the value', value)
  )
}

/** Parses the elements `$push` or `$addToSet` add, alone or in `$each`, keeping the modifiers. */
async function parseElements(
  schemas: core.$ZodType[],
  value: unknown,
  at: PropertyKey[]
): Promise<FieldResult> {
  const elements = schemas.map(elementsOf)
  const flat = elements.flatMap((each) => each ?? [])

  if (elements.some((each) => !each)) return fail(at, `"${String(at[1])}" is not an array`, value)
  if (!isPlainObject(value) || !('$each' in value)) return parseEvery(flat, value, at)

  const each: unknown = value.$each

  if (!Array.isArray(each)) return fail([...at, '$each'], '$each takes an array', each)

  const results = await Promise.all(
    each.map((element, index) => parseEvery(flat, element, [...at, '$each', index]))
  )
  const failed = results.find((result) => 'issues' in result)

  if (failed) return failed

  return {
    value: {
      ...value,
      $each: results.map((result) => ('value' in result ? result.value : undefined))
    }
  }
}

/** Checks one path of one operator, and returns the value to write. */
async function parseField(
  schema: core.$ZodType,
  operator: string,
  path: string,
  value: unknown,
  context: UpdateContext
): Promise<FieldResult> {
  const at = [operator, path]
  const renamesToId = operator === '$rename' && typeof value === 'string' && ID_PATH.test(value)

  // `$setOnInsert` writes it whole: a path inside it fails once another part of the `_id` is given.
  if ((ID_PATH.test(path) && (operator !== '$setOnInsert' || path !== '_id')) || renamesToId) {
    return fail(at, 'the _id is immutable: an upsert sets it whole with $setOnInsert', value)
  }

  const resolved = resolveUpdatePath(schema, path, context)

  if (resolved.kind === 'error') return fail(at, resolved.message, value)

  if (resolved.kind === 'discriminator') {
    // In an upsert, `$setOnInsert` can fix the discriminator: the value chooses one of the types.
    if (operator === '$setOnInsert') return parseAny(schemaAt(schema, path, 'update'), value, at)

    return fail(
      at,
      `"${path}" is the discriminator of its object: replace the object to change it`,
      value
    )
  }

  const { schemas } = resolved
  const segments = path.split('.')

  // An element of a set is written only by the operators that keep it a set.
  for (let end = 1; end < segments.length; end++) {
    const above = segments.slice(0, end).join('.')

    if (schemaAt(schema, above, 'update').some(isSet)) {
      return fail(
        at,
        `"${above}" is a set: write it whole, or use $addToSet, $pull, $pullAll or $pop`,
        value
      )
    }
  }

  if (operator === '$push' && schemas.some(isSet)) {
    return fail(at, `"${path}" is a set: use $addToSet`, value)
  }

  switch (operator) {
    case '$max':
    case '$min':
    case '$set':
    case '$setOnInsert':
      return parseEvery(schemas, value, at)

    case '$unset':
      // MongoDB sets an element of an array to `null`, which keeps its position.
      if (namesElement(schema, path)) {
        return schemas.every((target) => takes(target, null))
          ? { value }
          : fail(
              at,
              `$unset sets "${path}", an element of an array, to null, which it does not take`,
              value
            )
      }

      return schemas.every(isOptional) || isDynamicKey(schema, path)
        ? { value }
        : fail(at, `"${path}" is required, so it cannot be unset`, value)

    case '$inc':
    case '$mul':
      // A Decimal128 takes a decimal, such as the string of an amount. The checks of the field are
      // left out, as for numbers: they apply to the value, not to what changes it.
      if (schemas.every(isDecimal)) return parseEvery(schemas.map(withoutChecks), value, at)
      if (!schemas.every(isNumber)) return fail(at, `"${path}" is not a number`, value)
      if (typeof value !== 'number' && typeof value !== 'bigint') {
        return fail(at, `${operator} takes a number`, value)
      }

      if (typeof value === 'number' && !Number.isInteger(value) && schemas.some(isInteger)) {
        return fail(at, `"${path}" is an integer`, value)
      }

      return { value }

    case '$bit':
      return schemas.every(isNumber) ? { value } : fail(at, `"${path}" is not a number`, value)

    case '$currentDate':
      if (!schemas.every((target) => takes(target, new Date()))) {
        return fail(at, `"${path}" is not a date`, value)
      }

      // `{ $type: 'timestamp' }` writes a BSON Timestamp, which a date field does not take.
      return value === true || (isPlainObject(value) && value.$type === 'date')
        ? { value }
        : fail(at, "$currentDate takes true or { $type: 'date' }", value)

    case '$addToSet':
    case '$push':
      return parseElements(schemas, value, at)

    case '$pop':
    case '$pull':
    case '$pullAll':
      return schemas.every((target) => elementsOf(target))
        ? { value }
        : fail(at, `"${path}" is not an array`, value)

    case '$rename':
      if (inElement(schema, path)) {
        return fail(at, `"${path}" is in an array, which $rename cannot move`, value)
      }

      if (!schemas.every(isOptional) && !isDynamicKey(schema, path)) {
        return fail(at, `"${path}" is required, so it cannot be renamed`, value)
      }

      if (typeof value !== 'string') return fail(at, '$rename takes the new path', value)

      if (schemaAt(schema, value, 'update').length === 0) {
        return fail(at, `"${value}" is not a path of the document`, value)
      }

      return inElement(schema, value)
        ? fail(at, `"${value}" is in an array, which $rename cannot move to`, value)
        : { value }

    default:
      return fail(at, `"${operator}" is not an update operator`, value)
  }
}

/**
 * Validates an update with the schema, operator by operator and path by path, and returns it with
 * its values parsed and its `undefined` keys dropped. In an upsert, it also validates the document
 * the server would insert, and adds the defaults that document lacks with `$setOnInsert`. Throws a
 * `ZodError` with every problem it finds.
 */
export async function parseUpdate(
  schema: core.$ZodType,
  filter: Document,
  update: unknown,
  options: ParseUpdateOptions = {}
): Promise<Document> {
  if (!isPlainObject(update)) {
    throw new z.ZodRealError([
      {
        code: 'custom',
        input: update,
        message: 'an update is an object of operators, or a pipeline with updatePipeline: true',
        path: []
      }
    ])
  }

  const context: UpdateContext = { arrayFilters: options.arrayFilters ?? [], filter }
  const issues: core.$ZodIssue[] = []
  const parsed: Document = {}
  const given: Document = {}
  // In the order of the update, so that its issues keep it: the fields are parsed in parallel.
  const checks: Array<Promise<FieldResult & { at?: [string, string] }>> = []

  for (const [operator, fields] of Object.entries(update)) {
    if (!OPERATORS.has(operator)) {
      checks.push(
        Promise.resolve(fail([operator], `"${operator}" is not an update operator`, fields))
      )
      continue
    }

    if (!isPlainObject(fields)) {
      checks.push(Promise.resolve(fail([operator], `${operator} takes an object of paths`, fields)))
      continue
    }

    parsed[operator] = {}
    given[operator] = {}

    for (const [path, value] of Object.entries(fields)) {
      if (value === undefined) continue

      given[operator][path] = value
      checks.push(
        parseField(schema, operator, path, value, context).then((result) => ({
          ...result,
          at: [operator, path]
        }))
      )
    }
  }

  for (const check of await Promise.all(checks)) {
    if ('issues' in check) issues.push(...check.issues)
    else if (check.at) parsed[check.at[0]][check.at[1]] = check.value
  }

  const nullId = options.upsert ? nullIdIssue(filter) : undefined

  if (nullId) issues.push(nullId)

  // The upsert inserts the `_id` the filter gives, or a part of the `_id`, which `$setOnInsert`
  // would change (66) or, with the same value, repeat.
  if (
    options.upsert &&
    given.$setOnInsert?._id !== undefined &&
    [...filterEqualities(filter).keys()].some((path) => ID_PATH.test(path))
  ) {
    issues.push({
      code: 'custom',
      input: given.$setOnInsert._id,
      message: 'the filter gives the _id, which the upsert inserts: leave it out of $setOnInsert',
      path: ['$setOnInsert', '_id']
    })
  }

  if (issues.length === 0 && options.upsert) {
    const inserted = insertedDocument(filter, given)
    const result = await safeParseWritten(schema, inserted)

    if (!result.success) {
      // A field the inserted document lacks is given in the filter or with `$setOnInsert`.
      for (const issue of result.issues) {
        const value = issue.path.reduce<unknown>(
          (holder, key) =>
            typeof holder === 'object' && holder !== null ? Reflect.get(holder, key) : undefined,
          inserted
        )

        issues.push(
          value === undefined
            ? {
                ...issue,
                message: `${issue.message}: an upsert inserts it, so give it in the filter or with $setOnInsert`
              }
            : issue
        )
      }
    } else if (isPlainObject(result.data)) {
      issues.push(...storedAsFilteredIssues(filter, given, result.data))

      const defaults = insertDefaults(result.data, decidedPaths(filter, given))

      if (Object.keys(defaults).length > 0)
        parsed.$setOnInsert = { ...parsed.$setOnInsert, ...defaults }
    }
  }

  if (issues.length > 0) throw new z.ZodRealError(issues)

  return parsed
}
