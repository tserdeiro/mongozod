import type { Document } from 'mongodb'

import * as core from 'zod/v4/core'

import { IDENTIFIER, step } from '../schema/schema-at'
import { unwrapSchema } from '../schema/unwrap-schema'
import { isPlainObject } from '../utils/is-plain-object'

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

/** Where a path ends, and whether the context allows the types of document it goes through. */
type Step = { allowed: boolean } & (
  | { kind: 'discriminator' }
  | { kind: 'missing'; why: string }
  | { kind: 'ok'; schema: core.$ZodType }
)

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

/** One segment: the sub-schemas it leads to, with the scope after it. */
function next(
  schema: core.$ZodType,
  segment: string,
  scope: Scope,
  path: string
): Array<[core.$ZodType, Scope]> {
  return step(schema, segment, 'update').map(([sub, element]): [core.$ZodType, Scope] => {
    if (!element) return [sub, { ...scope, prefix: `${scope.prefix}${segment}.` }]

    const id = IDENTIFIER.exec(segment)?.[1]

    return [sub, id ? { id, kind: 'arrayFilter', prefix: '' } : { kind: 'none', path, prefix: '' }]
  })
}

function walkStep(
  schema: core.$ZodType,
  segments: string[],
  scope: Scope,
  context: UpdateContext,
  path: string,
  allowed: boolean
): Step[] {
  const [segment = '', ...rest] = segments
  const found = next(schema, segment, scope, path)

  if (found.length === 0) return [{ allowed, kind: 'missing', why: 'not a path' }]
  if (rest.length === 0) return found.map(([sub]) => ({ allowed, kind: 'ok', schema: sub }))

  return found.flatMap(([sub, nextScope]) =>
    walk(sub, rest, nextScope, context, path ? `${path}.${segment}` : segment, allowed)
  )
}

/**
 * Walks a path through every type of document, marking as not allowed the options of each
 * discriminated union that its scope rules out: they only tell whether the path exists.
 */
function walk(
  schema: core.$ZodType,
  segments: string[],
  scope: Scope,
  context: UpdateContext,
  path: string,
  allowed: boolean
): Step[] {
  const unwrapped = unwrapSchema(schema)

  if (!(unwrapped instanceof core.$ZodDiscriminatedUnion)) {
    return walkStep(schema, segments, scope, context, path, allowed)
  }

  const key = unwrapped._zod.def.discriminator

  if (segments.length === 1 && segments[0] === key) return [{ allowed, kind: 'discriminator' }]

  const fixed = scopeConstraints(scope, context, key)
  const options = unwrapped._zod.def.options.map((option) => {
    // The values Zod itself uses to tell the options apart.
    const values = [...(unwrapSchema(option)._zod.propValues?.[key] ?? [])]
    const matches = fixed.every((candidates) =>
      candidates.some((value) => values.some((own) => own === value))
    )

    return { matches, option }
  })
  const steps = options.flatMap(({ matches, option }) =>
    walkStep(option, segments, scope, context, path, allowed && matches)
  )

  for (const found of steps) {
    if (found.kind === 'missing' && found.why === 'not a path') found.why = fixAt(scope, key)
  }

  return options.some(({ matches }) => matches)
    ? steps
    : [{ allowed, kind: 'missing', why: 'no type matches the filter' }, ...steps]
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
  const steps = walk(schema, path.split('.'), { kind: 'filter', prefix: '' }, context, '', true)

  if (steps.every((found) => found.kind === 'missing')) {
    return { kind: 'error', message: `"${path}" is not a path of the document` }
  }

  const allowed = steps.filter((found) => found.allowed)

  if (allowed.some((found) => found.kind === 'discriminator')) return { kind: 'discriminator' }

  const schemas: core.$ZodType[] = []

  for (const found of allowed) {
    if (found.kind === 'missing')
      return { kind: 'error', message: `"${path}" is not in every type allowed: ${found.why}` }
    if (found.kind === 'ok') schemas.push(found.schema)
  }

  return { kind: 'ok', schemas }
}
