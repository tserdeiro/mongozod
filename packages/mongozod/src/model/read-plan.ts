import type { ReferenceTarget } from '../references/references'
import type { Virtual } from '../references/virtuals'
import type { ClientSession, Db, Document } from 'mongodb'
import type * as core from 'zod/v4/core'

import { z } from 'zod'

import {
  populateDocuments,
  populateEntries,
  removePath,
  storedPath
} from '../references/references'
import { computeVirtuals } from '../references/virtuals'
import { isPlainObject } from '../utils/is-plain-object'

/** What a read asks the server for, and what it does with each batch the server returns. */
export interface ReadPlan {
  /** The projection for the server: the one asked for, plus what virtuals and `populate` need. */
  projection?: Document | undefined

  /** Computes the virtuals of a batch and populates its references, in place. */
  process?: (documents: Document[]) => Promise<Document[]>
}

/** What a read uses of its model: its virtuals, its references and its database. */
export interface ReadContext {
  db: () => Db
  references: Record<string, ReferenceTarget>
  virtuals: ReadonlyMap<string, Virtual>
}

type Kind = 'elemMatch' | 'exclude' | 'include' | 'meta' | 'positional' | 'slice'

/** Every [path, kind] of a projection, dotted or nested, like the type `Entries`. */
function entriesOf(projection: Document, prefix = ''): Array<[string, Kind]> {
  return Object.entries(projection).flatMap(([key, value]): Array<[string, Kind]> => {
    const path = prefix + key

    if (value === undefined) return []
    if (value === 0 || value === false) return [[path, 'exclude']]
    if (!isPlainObject(value)) {
      return path.endsWith('.$') ? [[path.slice(0, -2), 'positional']] : [[path, 'include']]
    }

    if ('$slice' in value) return [[path, 'slice']]
    if ('$elemMatch' in value) return [[path, 'elemMatch']]
    if ('$meta' in value) return [[path, 'meta']]

    return entriesOf(value, `${path}.`)
  })
}

/** Whether a projection includes or excludes, as MongoDB 8.2 reads it, like the type `Mode`. */
function isInclusion(entries: ReadonlyArray<[string, Kind]>) {
  const kinds = new Set(entries.filter(([path]) => path !== '_id').map(([, kind]) => kind))

  if (kinds.has('include') || kinds.has('positional')) return true
  if (kinds.has('exclude') || kinds.has('slice')) return false

  return kinds.has('elemMatch')
}

/** Whether a path of the projection is a reference or an object above it. */
function covers(path: string, field: string) {
  return field === path || field.startsWith(`${path}.`)
}

/**
 * Plans a read with virtuals or `populate`. A projection that asks for a virtual also asks the
 * server for the fields it reads, which are removed afterwards, and an inclusion also returns the
 * references to populate. Throws a `ZodError` when the projection changes a field that an asked
 * virtual reads, or excludes a reference to populate.
 */
export function planRead(
  context: ReadContext,
  projection: Document | undefined,
  populate: unknown,
  session: ClientSession | undefined
): ReadPlan {
  const references = populateEntries(populate, context.references)

  if (context.virtuals.size === 0 && references.length === 0) return { projection }

  const fields: Document = { ...projection }
  const asked = new Map<string, boolean>()
  const issues: core.$ZodIssue[] = []

  for (const name of context.virtuals.keys()) {
    if (!Object.hasOwn(fields, name)) continue

    const value = fields[name]

    if (value === 0 || value === 1 || typeof value === 'boolean') {
      asked.set(name, value === 1 || value === true)
    } else if (value !== undefined) {
      issues.push({
        code: 'custom',
        input: value,
        message: `"${name}" is a virtual: it takes 0, 1, true or false`,
        path: ['projection', name]
      })
    }

    delete fields[name]
  }

  const entries = entriesOf(fields)
  const inclusion = isInclusion(entries) || [...asked.values()].includes(true)
  const computed = new Map<string, Virtual>()
  const strip = new Set<string>()
  // What a one-to-many reference matches, asked for it alone: removed once it is populated.
  const stripAfter = new Set<string>()

  if (inclusion) {
    // Asking for a reference under a path already included would be a path collision.
    for (const entry of references) {
      const field = storedPath(entry)
      const foreign = field !== entry[0]

      if (field === '_id' && (fields._id === 0 || fields._id === false)) {
        // An inclusion returns the `_id` unless it leaves it out.
        delete fields._id
        stripAfter.add(field)
      } else if (field !== '_id' && !entries.some(([path]) => covers(path, field))) {
        fields[field] = 1

        if (foreign) stripAfter.add(field)
      }
    }

    for (const [name, virtual] of context.virtuals) {
      if (!asked.get(name)) continue

      for (const need of virtual.needs) {
        const changed = entries.some(
          ([path, kind]) =>
            path.startsWith(`${need}.`) ||
            (path === need && kind !== 'include' && kind !== 'exclude')
        )

        if (changed) {
          issues.push({
            code: 'custom',
            input: projection,
            message: `"${name}" reads "${need}" as stored: the projection cannot change it`,
            path: ['projection', name]
          })
        } else if (need === '_id' && (fields._id === 0 || fields._id === false)) {
          // An inclusion returns the `_id` unless it leaves it out.
          delete fields._id
          strip.add(need)
        } else if (need !== '_id' && !Object.hasOwn(fields, need)) {
          fields[need] = 1
          strip.add(need)
        }
      }

      computed.set(name, virtual)
    }
  } else {
    for (const entry of references) {
      const field = storedPath(entry)

      if (entries.some(([path, kind]) => covers(path, field) && kind === 'exclude')) {
        issues.push({
          code: 'custom',
          input: projection,
          message:
            field === entry[0]
              ? `populate needs "${field}": the projection excludes it`
              : `populate needs "${field}" for "${entry[0]}": the projection excludes it`,
          path: ['populate', entry[0]]
        })
      }
    }

    for (const [name, virtual] of context.virtuals) {
      const touched = virtual.needs.some((need) =>
        entries.some(
          ([path, kind]) => kind !== 'meta' && (path === need || path.startsWith(`${need}.`))
        )
      )

      if (!asked.has(name) && !touched) computed.set(name, virtual)
    }
  }

  if (issues.length > 0) throw new z.ZodRealError(issues)

  return {
    projection: fields,
    async process(documents) {
      computeVirtuals(documents, computed)

      for (const document of documents) for (const field of strip) delete document[field]

      await populateDocuments(documents, references, context.db, session)

      for (const document of documents) for (const path of stripAfter) removePath(document, path)

      return documents
    }
  }
}
