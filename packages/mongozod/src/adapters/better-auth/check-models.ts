import type { AnyModel } from '../../plugins/plugin'
import type { BetterAuthDBSchema } from 'better-auth'

import { documentTypes } from '../../schema/document-types'
import { schemaAt } from '../../schema/schema-at'

/**
 * Throws an `Error` when a model is for a table Better Auth does not have, or its schema lacks a
 * field Better Auth writes in it: `_id`, its own fields and those of its plugins and of
 * `additionalFields`, by their `fieldName`. In a discriminated union, every type declares them.
 */
export function checkModels(
  models: Partial<Record<string, AnyModel>>,
  schema: BetterAuthDBSchema
): void {
  for (const [modelKey, model] of Object.entries(models)) {
    if (!model) continue

    const table = schema[modelKey]

    if (!table) {
      throw new Error(
        `Better Auth has no table "${modelKey}" for the model of "${model.name}": the keys of models are the names of its tables, such as "user" or "organization"`
      )
    }

    const fields = Object.entries(table.fields).map(([field, { fieldName }]) => fieldName || field)
    const types = documentTypes(model.schema)
    const missing = ['_id', ...fields].filter(
      (field) => !types.every((type) => schemaAt(type, field, 'filter').length > 0)
    )

    if (missing.length > 0) {
      throw new Error(
        `The schema of "${model.name}" lacks fields that Better Auth writes in its "${modelKey}" table: ${missing.join(', ')}`
      )
    }
  }
}
