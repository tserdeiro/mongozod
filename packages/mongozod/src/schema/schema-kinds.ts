import { z } from 'zod'
import * as core from 'zod/v4/core'

import { literalKeys } from '../mzod/fields/literal'
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
 * Whether every variant is a `Decimal128`, known by the `bsonType` of its metadata, as
 * `mz.decimal128()` declares it: `$inc` and `$mul` apply to it, as to numbers.
 */
export function isDecimal(schema: core.$ZodType): boolean {
  return variants(schema).every(
    (variant) => core.globalRegistry.get(variant)?.bsonType === 'decimal'
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

/**
 * Whether a schema is a field of `mz.literal()`, known by its check on the schema or on one under
 * its wrappers, lazies and pipes, such as `mz.literal(z.json()).optional()`.
 */
export function isLiteral(schema: core.$ZodType): boolean {
  if ((schema._zod.def.checks ?? []).includes(literalKeys)) return true

  if (
    schema instanceof core.$ZodCatch ||
    schema instanceof core.$ZodDefault ||
    schema instanceof core.$ZodNonOptional ||
    schema instanceof core.$ZodNullable ||
    schema instanceof core.$ZodOptional ||
    schema instanceof core.$ZodPrefault ||
    schema instanceof core.$ZodReadonly
  ) {
    return isLiteral(schema._zod.def.innerType)
  }

  if (schema instanceof core.$ZodLazy) return isLiteral(schema._zod.innerType)

  // What a pipe stores is its output, such as the schema of a `z.preprocess()`.
  return schema instanceof core.$ZodPipe && isLiteral(schema._zod.def.out)
}

/** Whether a schema has a field of `mz.literal()` at any level, walking each schema once. */
function walksToLiteral(schema: core.$ZodType, seen: Set<core.$ZodType>): boolean {
  if (isLiteral(schema)) return true

  const unwrapped = unwrapSchema(schema)

  // A recursive schema leads back to itself through its lazies.
  if (seen.has(unwrapped)) return false

  seen.add(unwrapped)

  let children: core.$ZodType[] = []

  if (unwrapped instanceof core.$ZodArray) children = [unwrapped._zod.def.element]
  else if (unwrapped instanceof core.$ZodRecord) children = [unwrapped._zod.def.valueType]
  else if (unwrapped instanceof core.$ZodUnion) children = [...unwrapped._zod.def.options]
  else if (unwrapped instanceof core.$ZodPipe) children = [unwrapped._zod.def.out]
  else if (unwrapped instanceof core.$ZodTuple) {
    const { items, rest } = unwrapped._zod.def

    children = rest ? [...items, rest] : [...items]
  } else if (unwrapped instanceof core.$ZodObject) {
    const { catchall, shape } = unwrapped._zod.def

    children = catchall ? [...Object.values(shape), catchall] : Object.values(shape)
  }

  return children.some((child) => walksToLiteral(child, seen))
}

const literalHolders = new WeakMap<core.$ZodType, boolean>()

/**
 * Whether a schema has a field of `mz.literal()` at any level, so that a write looks up the schema
 * of each key only when one can be there. Remembered by schema, as a model writes with the same.
 */
export function holdsLiteral(schema: core.$ZodType): boolean {
  let holds = literalHolders.get(schema)

  if (holds === undefined) {
    holds = walksToLiteral(schema, new Set())
    literalHolders.set(schema, holds)
  }

  return holds
}
