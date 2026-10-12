import * as core from 'zod/v4/core'

/** Whether a schema is a `z.object`, or a `z.discriminatedUnion` of objects or of other unions. */
function isDocument(schema: core.$ZodType): boolean {
  return (
    schema instanceof core.$ZodObject ||
    (schema instanceof core.$ZodDiscriminatedUnion && schema._zod.def.options.every(isDocument))
  )
}

/**
 * Throws an `Error` when the schema of a model is not what its types take, such as a document with
 * a `.transform()`, which an untyped call can pass: updates write paths of the document, which a
 * transform of the whole document cannot follow.
 */
export function checkRoot(schema: core.$ZodType): void {
  if (!isDocument(schema)) {
    throw new Error(
      'the schema of a model is a z.object or a z.discriminatedUnion of objects: a transform of the whole document does not run on updates, so a field computed from others goes in .overwrite()'
    )
  }
}
