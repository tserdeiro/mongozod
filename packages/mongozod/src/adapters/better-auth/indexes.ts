import type { BetterAuthDBSchema, DBFieldAttribute } from 'better-auth'
import type { Db, Document } from 'mongodb'

import { createLogger } from 'better-auth'
import { MongoNetworkError, MongoServerError, MongoServerSelectionError } from 'mongodb'

/** The longest index name, as Better Auth limits them for every database. */
const MAX_NAME_BYTES = 63

/** An index that already exists under another name, with the same key and options. */
const INDEX_OPTIONS_CONFLICT = 85
/** An index name that another definition already has. */
const INDEX_KEY_SPECS_CONFLICT = 86
const DUPLICATE_KEY = 11_000
const UNAUTHORIZED = 13

/**
 * Network errors, shutdowns and replica set changes, after which the next operation tries the index
 * again: the codes the driver retries reads on, as the official adapter.
 */
const TRANSIENT_CODES = new Set([
  6, 7, 89, 91, 189, 262, 9001, 10_107, 11_600, 11_602, 13_435, 13_436
])

/**
 * The partial filters of an optional unique field: they match every stored value and skip the
 * missing and `null` ones, which a SQL unique constraint also allows more than once. An equality
 * lookup can use an index with a range filter, not one with a `$type` filter.
 */
const UNIQUE_VALUE_FILTERS: Partial<Record<string, Document>> = {
  boolean: { $type: 'bool' },
  date: { $gte: new Date(-8_640_000_000_000_000) },
  number: { $gte: Number.NEGATIVE_INFINITY },
  string: { $gte: '' }
}

const encoder = new TextEncoder()

function bytes(value: string) {
  return encoder.encode(value).length
}

/** The FNV-1a hash Better Auth appends to the names it shortens. */
function hash(value: string) {
  let result = 2_166_136_261

  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16_777_619)
  }

  return (result >>> 0).toString(16).padStart(8, '0')
}

function truncate(value: string, maxBytes: number) {
  let result = ''

  for (const character of value) {
    if (bytes(result + character) > maxBytes) break

    result += character
  }

  return result
}

/** The name Better Auth gives an index, so both adapters build the same ones. */
function indexName(table: string, columns: readonly string[], unique: boolean, name?: string) {
  if (name !== undefined) return name

  const kind = unique ? 'uidx' : 'idx'
  const generated = `${table}_${columns.join('_')}_${kind}`

  if (bytes(generated) <= MAX_NAME_BYTES) return generated

  const suffix = `_${hash(generated)}_${kind}`

  return `${truncate(generated.slice(0, -kind.length - 1), MAX_NAME_BYTES - bytes(suffix))}${suffix}`
}

/** Why a field index could not be built, for the log. */
function failure(code: unknown, sameKey: readonly Document[]) {
  switch (code) {
    case UNAUTHORIZED:
      return 'the database user is not allowed to create indexes. Grant it the createIndex action or create the index yourself, then restart the application.'
    case INDEX_OPTIONS_CONFLICT:
      return `the index ${sameKey.map((index) => `"${index.name}"`).join(', ')} has the same key and different options. Drop it and restart the application.`
    case INDEX_KEY_SPECS_CONFLICT:
      return 'an index with that name and a different definition already exists. Drop or rename it and restart the application.'
    default:
      return 'of a server error. It is not retried until the application restarts.'
  }
}

interface TableIndex {
  columns: string[]
  name: string
  unique: boolean
}

interface FieldIndex {
  column: string
  key: string
  model: string
  name: string
  partialFilterExpression: Document | undefined
  unique: boolean
}

interface IndexesConfig {
  db: Db
  /** Builds a field index without waiting: false inside a transaction, which takes no index build. */
  build: boolean
  logger: Parameters<typeof createLogger>[0]
  /** The stored name of a Better Auth table. */
  modelName(modelKey: string): string
  /** The tables with a model, whose indexes the model declares. */
  routed(modelKey: string): boolean
  schema: BetterAuthDBSchema
}

/** The build state the instances of the adapter share, as the official adapter. */
export interface IndexBuilds {
  /** The field index builds started, by their definition. */
  readonly fields: Set<string>
  /** The field index builds that failed for a moment, which the next operation tries again. */
  readonly retries: Set<string>
  /** The table index builds, by their definition. */
  readonly tables: Map<string, Promise<unknown>>
  /** The field index builds whose temporary failure was logged. */
  readonly warned: Set<string>
}

export function indexBuilds(): IndexBuilds {
  return { fields: new Set(), retries: new Set(), tables: new Map(), warned: new Set() }
}

/**
 * The indexes Better Auth declares for the tables without a model, which SQL databases get from
 * migrations, as the official adapter creates them: a unique index for each `unique` field and an
 * index for each `index` one, built when the adapter is created, and the `indexes` of a table,
 * before its first write. A failure is logged and the app keeps working.
 */
export function betterAuthIndexes(config: IndexesConfig, builds: IndexBuilds) {
  const { db, schema } = config
  const logger = createLogger(config.logger)
  const tableIndexes = new Map<string, TableIndex[]>()

  function indexesOf(modelKey: string): TableIndex[] {
    const cached = tableIndexes.get(modelKey)

    if (cached) return cached

    const table = schema[modelKey]
    const model = config.modelName(modelKey)
    const resolved = (table && !table.disableMigrations ? (table.indexes ?? []) : []).map(
      (index) => {
        const columns = index.fields.map((field) => table?.fields[field]?.fieldName || field)

        return {
          columns,
          name: indexName(model, columns, index.unique ?? false, index.name),
          unique: index.unique ?? false
        }
      }
    )

    tableIndexes.set(modelKey, resolved)

    return resolved
  }

  function fieldIndexesOf(modelKey: string): FieldIndex[] {
    const table = schema[modelKey]

    if (!table || table.disableMigrations || config.routed(modelKey)) return []

    const model = config.modelName(modelKey)
    const singleField = indexesOf(modelKey).filter((index) => index.columns.length === 1)

    return Object.entries(table.fields).flatMap(([field, attributes]): FieldIndex[] => {
      if (!attributes.unique && !attributes.index) return []
      if (attributes.type === 'json' || attributes.type === 'string[]') return []
      if (attributes.type === 'number[]') return []

      const column = attributes.fieldName || field
      const unique = attributes.unique === true

      if (column === 'id') return []
      // A table index on the same field, at least as unique, already covers it.
      if (singleField.some((index) => index.columns[0] === column && (!unique || index.unique))) {
        return []
      }

      const partialFilterExpression =
        unique && attributes.required === false ? valueFilter(column, attributes) : undefined

      if (unique && attributes.required === false && !partialFilterExpression) return []

      const name = indexName(model, [column], unique)
      const key = JSON.stringify([model, name, column, unique, partialFilterExpression ?? null])

      return [{ column, key, model, name, partialFilterExpression, unique }]
    })
  }

  async function failed(index: FieldIndex, error: unknown) {
    const target = `"${index.name}" on ${index.model}.${index.column}`
    const transient =
      error instanceof MongoNetworkError ||
      error instanceof MongoServerSelectionError ||
      (error instanceof MongoServerError && TRANSIENT_CODES.has(Number(error.code)))

    if (transient) {
      builds.fields.delete(index.key)
      builds.retries.add(index.key)

      if (!builds.warned.has(index.key)) {
        builds.warned.add(index.key)
        logger.warn(
          `Could not create the MongoDB index ${target} yet. The next operation tries again.`,
          error
        )
      }

      return
    }

    if (!(error instanceof MongoServerError)) {
      const name = error instanceof Error ? error.name : 'unknown error'

      logger.error(
        `Could not create the MongoDB index ${target} (${name}). It is not retried until the application restarts.`
      )

      return
    }

    const reason = `${error.codeName ?? 'MongoServerError'} ${error.code}`

    if (error.code === DUPLICATE_KEY) {
      logger.error(
        `Could not create the unique MongoDB index ${target} because the collection already contains duplicate values (${reason}). Uniqueness is not enforced until the duplicates are removed and the application restarts.`
      )

      return
    }

    const key = JSON.stringify({ [index.column]: 1 })
    const sameKey = await db
      .collection(index.model)
      .listIndexes()
      .toArray()
      .then(
        (indexes) => indexes.filter((existing) => JSON.stringify(existing.key) === key),
        () => []
      )
    const equivalent = sameKey.some(
      (existing) =>
        (existing.unique === true) === index.unique &&
        JSON.stringify(existing.partialFilterExpression ?? null) ===
          JSON.stringify(index.partialFilterExpression ?? null)
    )

    if (equivalent) return

    logger.error(
      `Could not create the MongoDB index ${target} (${reason}) because ${failure(error.code, sameKey)}`
    )
  }

  function buildFieldIndex(index: FieldIndex) {
    if (builds.fields.has(index.key)) return

    builds.fields.add(index.key)

    const options: Document = { name: index.name, timeoutMS: 0, unique: index.unique }

    if (index.partialFilterExpression) {
      options.partialFilterExpression = index.partialFilterExpression
    }

    // Not awaited: requests do not wait for the build, and a failure is logged.
    Promise.resolve()
      .then(() => db.collection(index.model).createIndex({ [index.column]: 1 }, options))
      .catch((error: unknown) => failed(index, error))
      .catch(() => undefined)
  }

  const fieldIndexes = config.build ? Object.keys(schema).flatMap(fieldIndexesOf) : []

  for (const index of fieldIndexes) buildFieldIndex(index)

  return {
    /** Builds again the field indexes that failed for a moment. */
    retry() {
      if (!config.build || builds.retries.size === 0) return

      for (const index of fieldIndexes) {
        if (builds.retries.delete(index.key)) buildFieldIndex(index)
      }
    },

    /** Creates the `indexes` of a table without a model, once, before its first write. */
    async table(modelKey: string) {
      if (config.routed(modelKey)) return

      const model = config.modelName(modelKey)

      await Promise.all(
        indexesOf(modelKey).map((index) => {
          const columns = index.columns.map((column) => (column === 'id' ? '_id' : column))
          const definition = JSON.stringify([model, index.name, columns, index.unique])
          const started = builds.tables.get(definition)

          if (started) return started

          const build = Promise.resolve().then(() =>
            db
              .collection(model)
              .createIndex(Object.fromEntries(columns.map((column) => [column, 1])), {
                name: index.name,
                unique: index.unique
              })
          )

          builds.tables.set(definition, build)
          // A failed build is tried again by the next write.
          build.catch(() => {
            if (builds.tables.get(definition) === build) builds.tables.delete(definition)
          })

          return build
        })
      )
    }
  }
}

/** The partial filter of an optional unique field, or `undefined` for a type it cannot filter. */
function valueFilter(column: string, attributes: DBFieldAttribute): Document | undefined {
  const filter =
    attributes.references?.field === 'id'
      ? { $type: ['string', 'objectId', 'binData'] }
      : UNIQUE_VALUE_FILTERS[Array.isArray(attributes.type) ? 'string' : attributes.type]

  return filter && { [column]: filter }
}
