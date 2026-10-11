import { z } from 'zod'
import * as core from 'zod/v4/core'

import { uniqueValues } from '../mzod/fields/set'

import { unwrapSchema } from './unwrap-schema'

function isNullish(schema: core.$ZodType) {
  return schema instanceof core.$ZodNull || schema instanceof core.$ZodUndefined
}

/** The options of a union that can hold a value, without `null` and `undefined`. */
export function variants(schema: core.$ZodType): core.$ZodType[] {
  const unwrapped = unwrapSchema(schema)

  if (unwrapped instanceof core.$ZodUnion) {
    return unwrapped._zod.def.options.filter((option) => !isNullish(option)).flatMap(variants)
  }

  if (unwrapped instanceof core.$ZodPipe) return variants(unwrapped._zod.def.out)

  return [unwrapped]
}

export function isNumber(schema: core.$ZodType): boolean {
  return variants(schema).every(
    (variant) => variant instanceof core.$ZodNumber || variant instanceof core.$ZodBigInt
  )
}

/**
 * Zod rejects a fraction in an integer field with `expected: 'int'`. Zod Classic also tells it with
 * `format`, but Zod Mini does not, so the probe works for both.
 */
export function isInteger(schema: core.$ZodType): boolean {
  const result = z.safeParse(schema, 0.5)

  return (
    !result.success &&
    result.error.issues.some((issue) => issue.code === 'invalid_type' && issue.expected === 'int')
  )
}

/**
 * Whether a schema takes a value of its type, for the checks that ask what a field stores. An async
 * refinement makes the sync parse throw once the value passed the sync checks, so that counts as
 * taking it.
 */
export function takes(schema: core.$ZodType, value: unknown): boolean {
  try {
    return z.safeParse(schema, value).success
  } catch (error) {
    if (error instanceof core.$ZodAsyncError) return true

    throw error
  }
}

export function isOptional(schema: core.$ZodType): boolean {
  return schema._zod.optout === 'optional'
}

/** The schemas of the elements, when every variant is an array. */
export function elementsOf(schema: core.$ZodType): core.$ZodType[] | undefined {
  const elements: core.$ZodType[] = []

  for (const variant of variants(schema)) {
    if (!(variant instanceof core.$ZodArray)) return undefined

    elements.push(variant._zod.def.element)
  }

  return elements
}

/** Whether a variant is a set of `mz.set()`, known by its check. */
export function isSet(schema: core.$ZodType): boolean {
  return variants(schema).some(
    (variant) =>
      variant instanceof core.$ZodArray && (variant._zod.def.checks ?? []).includes(uniqueValues)
  )
}
