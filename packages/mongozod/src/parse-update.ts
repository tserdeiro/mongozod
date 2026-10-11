import type { UpdateContext } from './update-path'
import type { Document } from 'mongodb'
import type * as core from 'zod/v4/core'

import { z } from 'zod'

import { isPlainObject } from './is-plain-object'
import { safeParseWritten } from './parse-document'
import { schemaAt } from './schema-at'
import { elementsOf, isInteger, isNumber, isOptional } from './schema-kinds'
import { resolveUpdatePath } from './update-path'
import { decidedPaths, insertDefaults, insertedDocument } from './upsert'

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

type FieldResult = { issues: core.$ZodIssue[] } | { value: unknown }

function fail(path: PropertyKey[], message: string, input: unknown): FieldResult {
  return { issues: [{ code: 'custom', input, message, path }] }
}

/** Parses a value with every schema it has to fit, and keeps what the first one returns. */
function parseEvery(schemas: core.$ZodType[], value: unknown, at: PropertyKey[]): FieldResult {
  let data: unknown

  for (const [index, schema] of schemas.entries()) {
    const result = safeParseWritten(schema, value)

    if (!result.success) {
      return { issues: result.issues.map((issue) => ({ ...issue, path: [...at, ...issue.path] })) }
    }

    if (index === 0) data = result.data
  }

  return { value: data }
}

/** Parses a value with the first schema it fits. */
function parseAny(schemas: core.$ZodType[], value: unknown, at: PropertyKey[]): FieldResult {
  let first: FieldResult | undefined

  for (const schema of schemas) {
    const result = parseEvery([schema], value, at)

    if ('value' in result) return result

    first ??= result
  }

  return first ?? fail(at, 'no type takes the value', value)
}

/** Parses the elements `$push` or `$addToSet` add, alone or in `$each`, keeping the modifiers. */
function parseElements(schemas: core.$ZodType[], value: unknown, at: PropertyKey[]): FieldResult {
  const elements = schemas.map(elementsOf)
  const flat = elements.flatMap((each) => each ?? [])

  if (elements.some((each) => !each)) return fail(at, `"${String(at[1])}" is not an array`, value)
  if (!isPlainObject(value) || !('$each' in value)) return parseEvery(flat, value, at)

  const each: unknown = value.$each

  if (!Array.isArray(each)) return fail([...at, '$each'], '$each takes an array', each)

  const parsed: unknown[] = []

  for (const [index, element] of each.entries()) {
    const result = parseEvery(flat, element, [...at, '$each', index])

    if ('issues' in result) return result

    parsed.push(result.value)
  }

  return { value: { ...value, $each: parsed } }
}

/** Checks one path of one operator, and returns the value to write. */
function parseField(
  schema: core.$ZodType,
  operator: string,
  path: string,
  value: unknown,
  context: UpdateContext
): FieldResult {
  const at = [operator, path]
  const resolved = resolveUpdatePath(schema, path, context)

  if (resolved.kind === 'error') return fail(at, resolved.message, value)

  if (resolved.kind === 'discriminator') {
    // In an upsert, `$setOnInsert` can fix the discriminator: the value chooses one of the types.
    if (operator === '$setOnInsert') return parseAny(schemaAt(schema, path, 'update'), value, at)

    return fail(at, `"${path}" changes the type of its object: replace the object`, value)
  }

  const { schemas } = resolved

  switch (operator) {
    case '$max':
    case '$min':
    case '$set':
    case '$setOnInsert':
      return parseEvery(schemas, value, at)

    case '$unset':
      return schemas.every(isOptional)
        ? { value }
        : fail(at, `"${path}" is required, so it cannot be unset`, value)

    case '$inc':
    case '$mul':
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
      return schemas.every((target) => z.safeParse(target, new Date()).success)
        ? { value }
        : fail(at, `"${path}" is not a date`, value)

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
      if (!schemas.every(isOptional)) {
        return fail(at, `"${path}" is required, so it cannot be renamed`, value)
      }

      if (typeof value !== 'string') return fail(at, '$rename takes the new path', value)

      return schemaAt(schema, value, 'update').length > 0
        ? { value }
        : fail(at, `"${value}" is not a path of the document`, value)

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
export function parseUpdate(
  schema: core.$ZodType,
  filter: Document,
  update: unknown,
  options: ParseUpdateOptions = {}
): Document {
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

  for (const [operator, fields] of Object.entries(update)) {
    if (!OPERATORS.has(operator)) {
      issues.push({
        code: 'custom',
        input: fields,
        message: `"${operator}" is not an update operator`,
        path: [operator]
      })
      continue
    }

    if (!isPlainObject(fields)) {
      issues.push({
        code: 'custom',
        input: fields,
        message: `${operator} takes an object of paths`,
        path: [operator]
      })
      continue
    }

    const written: Document = {}
    const kept: Document = {}

    for (const [path, value] of Object.entries(fields)) {
      if (value === undefined) continue

      const result = parseField(schema, operator, path, value, context)

      if ('issues' in result) issues.push(...result.issues)
      else written[path] = result.value

      kept[path] = value
    }

    parsed[operator] = written
    given[operator] = kept
  }

  if (issues.length === 0 && options.upsert) {
    const result = safeParseWritten(schema, insertedDocument(filter, given))

    if (!result.success) issues.push(...result.issues)
    else if (isPlainObject(result.data)) {
      const defaults = insertDefaults(result.data, decidedPaths(filter, given))

      if (Object.keys(defaults).length > 0)
        parsed.$setOnInsert = { ...parsed.$setOnInsert, ...defaults }
    }
  }

  if (issues.length > 0) throw new z.ZodRealError(issues)

  return parsed
}
