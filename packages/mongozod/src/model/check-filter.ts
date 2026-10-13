import type { Document } from 'mongodb'
import type * as core from 'zod/v4/core'

import { z } from 'zod'

import { isPlainObject } from '../utils/is-plain-object'

/** The issues of the `undefined` values of a filter, at any level, each at its path. */
function undefinedIssues(value: unknown, path: PropertyKey[], issues: core.$ZodIssue[]): void {
  if (value === undefined) {
    issues.push({
      code: 'custom',
      input: value,
      message:
        'a filter cannot have an undefined value: the driver would send null, which matches the documents without the field',
      path
    })
  } else if (Array.isArray(value)) {
    for (const [index, element] of value.entries())
      undefinedIssues(element, [...path, index], issues)
  } else if (isPlainObject(value)) {
    for (const [key, field] of Object.entries(value)) undefinedIssues(field, [...path, key], issues)
  }
}

/**
 * Throws a `ZodError` when a filter has an `undefined` value, at any level, such as `{ token:
 * body.token }` for a body without one: the driver sends it as `null`, which matches the documents
 * without the field. The types of the model reject it, and a request typed `any` compiles, so this
 * is the runtime half of that check, like the one of a `sort` string.
 */
export function checkFilter(filter: Document): void {
  const issues: core.$ZodIssue[] = []

  undefinedIssues(filter, [], issues)

  if (issues.length > 0) throw new z.ZodRealError(issues)
}
