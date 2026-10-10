import type { Document } from 'mongodb'

import { z } from 'zod'
import * as core from 'zod/v4/core'

import { isPlainObject } from './is-plain-object'
import { schemaAt } from './schema-at'
import { unwrapSchema } from './unwrap-schema'

/** What selects the documents and the array elements an update writes. */
export interface UpdateContext {
  arrayFilters: readonly Document[]
  filter: Document
}

/** What a path of an update writes: the schemas of every type the context allows, or why not. */
export type UpdatePath =
  | { kind: 'discriminator' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; schemas: core.$ZodType[] }

/** Where the conditions that select the current document or element come from. */
type Scope =
  | { kind: 'filter'; prefix: string }
  | { id: string; kind: 'arrayFilter'; prefix: string }
  | { kind: 'none'; path: string; prefix: string }

type Step =
  | { kind: 'discriminator' }
  | { kind: 'missing'; why: string }
  | { kind: 'ok'; schema: core.$ZodType }

/** An `arrayFilters` identifier, as the MongoDB manual defines it. */
const IDENTIFIER = /^\$\[([a-z][a-zA-Z0-9]*)\]$/

const INDEX = /^\d+$/

/** The values an equality, `$eq` or `$in` fixes, or `undefined` for any other condition. */
function fixes(condition: unknown): readonly unknown[] | undefined {
  if (!isPlainObject(condition)) return [condition]
  if ('$eq' in condition) return [condition.$eq]
  if (Array.isArray(condition.$in)) return condition.$in

  return undefined
}

/** The values a query fixes for a key, at its top level or inside `$and`. */
function constraintsAt(query: Document, key: string): Array<readonly unknown[]> {
  const own = key in query ? fixes(query[key]) : undefined
  const parts: unknown[] = Array.isArray(query.$and) ? query.$and : []
  const nested = parts.filter(isPlainObject).flatMap((part) => constraintsAt(part, key))

  return own ? [own, ...nested] : nested
}

function scopeConstraints(scope: Scope, context: UpdateContext, key: string) {
  if (scope.kind === 'filter') return constraintsAt(context.filter, `${scope.prefix}${key}`)
  if (scope.kind === 'none') return []

  return context.arrayFilters.flatMap((entry) =>
    constraintsAt(entry, `${scope.id}.${scope.prefix}${key}`)
  )
}

/** Where to fix a union's discriminator, for the error message. */
function fixAt(scope: Scope, key: string) {
  if (scope.kind === 'filter') return `fix "${scope.prefix}${key}" in the filter`
  if (scope.kind === 'arrayFilter') return `fix "${scope.id}.${scope.prefix}${key}" in arrayFilters`

  return `reach "${scope.path}" with $[id] and fix "id.${scope.prefix}${key}" in arrayFilters`
}

function extend(scope: Scope, segment: string): Scope {
  return { ...scope, prefix: `${scope.prefix}${segment}.` }
}

/** One segment: the sub-schemas it leads to, with the scope after it. */
function next(
  schema: core.$ZodType,
  segment: string,
  scope: Scope,
  path: string
): Array<[core.$ZodType, Scope]> {
  const unwrapped = unwrapSchema(schema)

  if (unwrapped instanceof core.$ZodAny || unwrapped instanceof core.$ZodUnknown) {
    return [[unwrapped, extend(scope, segment)]]
  }

  if (unwrapped instanceof core.$ZodUnion) {
    return unwrapped._zod.def.options.flatMap((option) => next(option, segment, scope, path))
  }

  if (unwrapped instanceof core.$ZodObject) {
    const { catchall, shape } = unwrapped._zod.def
    const field = Object.hasOwn(shape, segment) ? shape[segment] : catchall

    return field && !(field instanceof core.$ZodNever) ? [[field, extend(scope, segment)]] : []
  }

  if (unwrapped instanceof core.$ZodRecord) {
    const { keyType, valueType } = unwrapped._zod.def

    return z.safeParse(keyType, segment).success ? [[valueType, extend(scope, segment)]] : []
  }

  if (!(unwrapped instanceof core.$ZodArray)) return []

  const { element } = unwrapped._zod.def
  const id = IDENTIFIER.exec(segment)?.[1]

  if (id) return [[element, { id, kind: 'arrayFilter', prefix: '' }]]
  if (segment === '$' || segment === '$[]' || INDEX.test(segment)) {
    return [[element, { kind: 'none', path, prefix: '' }]]
  }

  return []
}

function walkStep(
  schema: core.$ZodType,
  segments: string[],
  scope: Scope,
  context: UpdateContext,
  path: string
): Step[] {
  const [segment = '', ...rest] = segments
  const found = next(schema, segment, scope, path)

  if (found.length === 0) return [{ kind: 'missing', why: 'not a path' }]
  if (rest.length === 0) return found.map(([sub]) => ({ kind: 'ok', schema: sub }))

  return found.flatMap(([sub, nextScope]) =>
    walk(sub, rest, nextScope, context, path ? `${path}.${segment}` : segment)
  )
}

/** Walks a path: at each discriminated union, only into the options its scope allows. */
function walk(
  schema: core.$ZodType,
  segments: string[],
  scope: Scope,
  context: UpdateContext,
  path: string
): Step[] {
  const unwrapped = unwrapSchema(schema)

  if (!(unwrapped instanceof core.$ZodDiscriminatedUnion)) {
    return walkStep(schema, segments, scope, context, path)
  }

  const key = unwrapped._zod.def.discriminator

  if (segments[0] === key) return [{ kind: 'discriminator' }]

  const fixed = scopeConstraints(scope, context, key)
  const allowed = unwrapped._zod.def.options.filter((option) => {
    // The values Zod itself uses to tell the options apart.
    const values = [...(unwrapSchema(option)._zod.propValues?.[key] ?? [])]

    return fixed.every((candidates) =>
      candidates.some((value) => values.some((own) => own === value))
    )
  })

  if (allowed.length === 0) return [{ kind: 'missing', why: 'no type matches the filter' }]

  return allowed.flatMap((option) =>
    walkStep(option, segments, scope, context, path).map((step) =>
      step.kind === 'missing' && step.why === 'not a path'
        ? { kind: 'missing', why: fixAt(scope, key) }
        : step
    )
  )
}

/**
 * Resolves a path of an update like its types do: through every array with a positional operator,
 * and at each discriminated union, only into the types that the filter, or the `arrayFilters`
 * entry of its `$[id]`, allows. A path written in every one of them leads to all their schemas.
 */
export function resolveUpdatePath(
  schema: core.$ZodType,
  path: string,
  context: UpdateContext
): UpdatePath {
  if (schemaAt(schema, path, 'update').length === 0) {
    return { kind: 'error', message: `"${path}" is not a path of the document` }
  }

  const steps = walk(schema, path.split('.'), { kind: 'filter', prefix: '' }, context, '')

  if (steps.some((step) => step.kind === 'discriminator')) return { kind: 'discriminator' }

  const schemas: core.$ZodType[] = []

  for (const step of steps) {
    if (step.kind === 'missing')
      return { kind: 'error', message: `"${path}" is not in every type allowed: ${step.why}` }
    if (step.kind === 'ok') schemas.push(step.schema)
  }

  return { kind: 'ok', schemas }
}
