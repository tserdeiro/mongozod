import type { Document } from 'mongodb'

import { isPlainObject } from '../utils/is-plain-object'

/** What a projection does with a path, like the type `Kind`. */
export type ProjectionKind = 'elemMatch' | 'exclude' | 'include' | 'meta' | 'positional' | 'slice'

/** Every [path, kind] of a projection, dotted or nested, like the type `Entries`. */
export function projectionEntries(
  projection: Document,
  prefix = ''
): Array<[string, ProjectionKind]> {
  return Object.entries(projection).flatMap(([key, value]): Array<[string, ProjectionKind]> => {
    const path = prefix + key

    if (value === undefined) return []
    if (value === 0 || value === false) return [[path, 'exclude']]
    if (!isPlainObject(value)) {
      return path.endsWith('.$') ? [[path.slice(0, -2), 'positional']] : [[path, 'include']]
    }

    if ('$slice' in value) return [[path, 'slice']]
    if ('$elemMatch' in value) return [[path, 'elemMatch']]
    if ('$meta' in value) return [[path, 'meta']]

    return projectionEntries(value, `${path}.`)
  })
}

/**
 * Whether a projection includes or excludes, as MongoDB 8.2 reads it, like the type `Mode`: an
 * included `_id` makes an inclusion of a projection without other inclusions or exclusions, such
 * as `{ _id: 1 }` alone or with a `$slice`.
 */
export function isInclusion(entries: ReadonlyArray<[string, ProjectionKind]>): boolean {
  const kinds = new Set(entries.filter(([path]) => path !== '_id').map(([, kind]) => kind))

  if (kinds.has('include') || kinds.has('positional')) return true
  if (kinds.has('exclude')) return false
  if (entries.some(([path, kind]) => path === '_id' && kind === 'include')) return true
  if (kinds.has('slice')) return false

  return kinds.has('elemMatch')
}
