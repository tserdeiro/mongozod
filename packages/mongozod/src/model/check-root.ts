import * as core from 'zod/v4/core'

/** What in a schema is not a `z.object` or a `z.discriminatedUnion` of them, if anything. */
function notDocument(schema: core.$ZodType): core.$ZodType | undefined {
  if (schema instanceof core.$ZodObject) return undefined
  if (!(schema instanceof core.$ZodDiscriminatedUnion)) return schema

  return schema._zod.def.options.map(notDocument).find((found) => found !== undefined)
}

/**
 * Throws an `Error` when the schema of a model is not what its types take, such as a document with
 * a `.transform()`, which an untyped call can pass: updates write paths of the document, which a
 * transform of the whole document cannot follow.
 */
export function checkRoot(schema: core.$ZodType): void {
  const found = notDocument(schema)

  if (!found) return

  const { type } = found._zod.def

  throw new Error(
    type === 'pipe'
      ? 'the schema of a model is a z.object or a z.discriminatedUnion of objects: a transform of the whole document does not run on updates, so a field computed from others goes in .overwrite()'
      : `the schema of a model is a z.object or a z.discriminatedUnion of objects, not a z.${type}()`
  )
}
