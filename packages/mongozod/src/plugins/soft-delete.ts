import type { Document } from 'mongodb'

import { z } from 'zod'

import { definePlugin } from './plugin'

const LOGICAL_OPERATORS = new Set(['$and', '$nor', '$or'])

/** Without `deletedAt`. Unlike `deletedAt: null`, an upsert does not copy it into the new document. */
const NOT_DELETED = { deletedAt: { $exists: false } }

/**
 * True when the filter already says something about `deletedAt`, here or inside `$and`, `$or` or
 * `$nor`.
 */
function mentionsDeletedAt(filter: Document = {}): boolean {
  return Object.entries(filter).some(
    ([key, value]) =>
      key === 'deletedAt' ||
      (LOGICAL_OPERATORS.has(key) && Array.isArray(value) && value.some(mentionsDeletedAt))
  )
}

/** Adds the soft delete condition, unless the caller's filter already decides about `deletedAt`. */
function excludeDeleted(filter: Document = {}): Document {
  if (mentionsDeletedAt(filter)) return filter

  return { $and: [filter, NOT_DELETED] }
}

/** The update a delete of a `bulkWrite` becomes. */
const MARKING_UPDATES = { deleteMany: 'updateMany', deleteOne: 'updateOne' }

/** The update that marks a document as deleted. */
function mark() {
  return { $set: { deletedAt: new Date() } }
}

/**
 * One operation of a `bulkWrite` under the same rules: a delete marks `deletedAt` unless its filter
 * mentions it, and the other writes skip the deleted documents.
 */
function bulkOperation(operation: Document): Document {
  for (const [kind, update] of Object.entries(MARKING_UPDATES)) {
    if (!(kind in operation)) continue

    const { filter, ...rest } = operation[kind]

    if (mentionsDeletedAt(filter)) return operation

    return { [update]: { ...rest, filter: excludeDeleted(filter), update: mark() } }
  }

  for (const kind of ['replaceOne', 'updateMany', 'updateOne']) {
    if (kind in operation) {
      return { [kind]: { ...operation[kind], filter: excludeDeleted(operation[kind].filter) } }
    }
  }

  return operation
}

/**
 * Soft delete. Reads and updates skip the documents with `deletedAt`, and deletes mark it instead
 * of removing the document, with an update dispatched through the model, so `timestamps` and the
 * other plugins see an update. A filter that mentions `deletedAt` takes over: the plugin leaves it
 * alone, so `{ deletedAt: { $exists: true } }` reads the trash and a delete with it removes for
 * real. `aggregate` and `estimatedDocumentCount` see every document.
 *
 * @example
 *   // The schema declares the field the plugin writes.
 *   const noteSchema = z.object({ deletedAt: z.date().optional(), title: z.string() })
 *
 *   export const NotesModel = mongozod({
 *     collection: 'notes',
 *     db,
 *     plugins: [softDelete()],
 *     schema: noteSchema
 *   })
 *
 * @see https://mongozod.dev/docs/plugins/soft-delete
 */
export function softDelete() {
  return definePlugin({
    fields: { deletedAt: z.date().optional() },

    hooks: {
      bulkWrite: {
        before: ({ args }) => ({
          args: { ...args, operations: args.operations.map(bulkOperation) }
        })
      },

      deleteMany: {
        async before({ args, model }) {
          if (mentionsDeletedAt(args.filter)) return undefined

          const result = await model.updateMany(args.filter, mark(), args.options)

          return {
            result: { acknowledged: result.acknowledged, deletedCount: result.modifiedCount }
          }
        }
      },

      deleteOne: {
        async before({ args, model }) {
          if (mentionsDeletedAt(args.filter)) return undefined

          const result = await model.updateOne(args.filter, mark(), args.options)

          return {
            result: { acknowledged: result.acknowledged, deletedCount: result.modifiedCount }
          }
        }
      },

      // Like the driver's, it returns the document as it was before the delete.
      findOneAndDelete: {
        async before({ args, model }) {
          if (mentionsDeletedAt(args.filter)) return undefined

          const options = { ...args.options, returnDocument: 'before' }

          return { result: await model.findOneAndUpdate(args.filter, mark(), options) }
        }
      },

      read: {
        before: ({ args }) => ({ args: { ...args, filter: excludeDeleted(args.filter) } })
      },

      update: {
        before: ({ args }) => ({ args: { ...args, filter: excludeDeleted(args.filter) } })
      }
    },

    id: 'softDelete'
  })
}
