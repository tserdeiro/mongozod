import { z } from 'zod'
import * as core from 'zod/v4/core'

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
