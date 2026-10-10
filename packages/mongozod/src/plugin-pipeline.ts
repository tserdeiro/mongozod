// oxlint-disable eslint/no-await-in-loop -- hooks run one after the other, in the order of the plugins
import type { AnyModel, Group, Operation } from './plugin'
import type { ClientSession, Document } from 'mongodb'
import type * as core from 'zod/v4/core'

import { z } from 'zod'

import { documentTypes } from './document-types'
import { isPlainObject } from './is-plain-object'
import { GROUPS } from './plugin'
import { schemaAt } from './schema-at'

/** The hooks of an operation or a group, as the core runs them: with any operation's input. */
interface RuntimeHooks {
  after?(input: Document): unknown
  before?(input: Document): unknown
}

/** A plugin as the core runs it. Every `Plugin` is one: its hooks are methods. */
export interface RuntimePlugin {
  context?: Partial<Record<Group, core.$ZodObject>>
  fields?: core.$ZodShape
  hooks?: Partial<Record<string, RuntimeHooks>>
  id: string
  methods?: object
  middleware?(input: Document): Promise<unknown>
  options?: Partial<Record<Group, core.$ZodObject>>
}

/** The plugins of a model, and the model their hooks receive. */
export interface Pipeline {
  model: AnyModel
  plugins: readonly RuntimePlugin[]
}

/** The options mongozod takes besides the driver's, which no plugin option can shadow. */
const OWN_OPTIONS = new Set(['context', 'populate', 'schema', 'timestamps'])

const GROUP_NAMES: readonly Group[] = ['bulk', 'delete', 'insert', 'read', 'update']

/** The group of an operation: `aggregate` and `estimatedDocumentCount` have none. */
export function groupOf(operation: Operation): Group | undefined {
  return GROUP_NAMES.find((group) => GROUPS[group].some((name: string) => name === operation))
}

/**
 * Checks the plugins of a model when it is defined, and throws an `Error` when one of them needs a
 * field the schema does not declare in every type of document, two of them define the same method,
 * or an option shadows one of mongozod's or another plugin's.
 */
export function checkPlugins(schema: core.$ZodType, plugins: readonly RuntimePlugin[]): void {
  const types = documentTypes(schema)
  const methods = new Set<string>()
  const options = new Map<string, string>()

  for (const plugin of plugins) {
    for (const field of Object.keys(plugin.fields ?? {})) {
      if (!types.every((type) => schemaAt(type, field, 'filter').length > 0)) {
        throw new Error(`${plugin.id} needs the field "${field}" in the schema`)
      }
    }

    for (const method of Object.keys(plugin.methods ?? {})) {
      if (methods.has(method)) throw new Error(`two plugins define "${method}"`)

      methods.add(method)
    }

    // An option belongs to its plugin in every group, so two plugins never share one.
    const names = new Set(
      Object.values(plugin.options ?? {}).flatMap((group) => Object.keys(group._zod.def.shape))
    )

    for (const name of names) {
      const owner = options.get(name)

      if (OWN_OPTIONS.has(name)) throw new Error(`${plugin.id}: "${name}" is an option of mongozod`)
      if (owner) throw new Error(`${plugin.id}: "${name}" is an option of ${owner}`)

      options.set(name, plugin.id)
    }
  }
}

/** What an operation runs with: its arguments, and the context of each plugin. */
interface Prepared {
  args: Document
  contexts: unknown[]
}

/**
 * Validates the context and the plugin options of an operation, and gives each plugin its context.
 * The options keep the parsed values of the plugin options, and the context as it was written, so
 * that a hook can dispatch another operation with them. Throws a `ZodError` when one fails.
 */
function prepare(
  plugins: readonly RuntimePlugin[],
  operation: Operation,
  args: Document
): Prepared {
  const group = groupOf(operation)
  const options: Document = { ...args.options }
  const issues: core.$ZodIssue[] = []

  const contexts = plugins.map((plugin) => {
    const optionsSchema = group && plugin.options?.[group]
    const contextSchema = group && plugin.context?.[group]

    if (optionsSchema) {
      const result = z.safeParse(optionsSchema, args.options ?? {})

      if (result.success) Object.assign(options, result.data)
      else issues.push(...result.error.issues)
    }

    if (!contextSchema) return undefined

    const result = z.safeParse(contextSchema, args.options?.context)

    if (result.success) return result.data

    for (const issue of result.error.issues)
      issues.push({ ...issue, path: ['context', ...issue.path] })

    return undefined
  })

  if (issues.length > 0) throw new z.ZodRealError(issues)

  return { args: { ...args, options }, contexts }
}

/** The arguments for the core: without the context and the options of the plugins. */
function forCore(plugins: readonly RuntimePlugin[], operation: Operation, args: Document) {
  const group = groupOf(operation)
  const { context: _context, ...options } = args.options ?? {}

  for (const plugin of plugins) {
    const schema = group && plugin.options?.[group]

    for (const name of Object.keys(schema ? schema._zod.def.shape : {})) delete options[name]
  }

  return { ...args, options }
}

/** The hooks of a plugin for an operation, from the general to the particular. */
function hooksOf(plugin: RuntimePlugin, operation: Operation) {
  const group = groupOf(operation)

  return [group && plugin.hooks?.[group], plugin.hooks?.[operation]].filter((hooks) => !!hooks)
}

/** The session `next({ session })` gives, in the options of the operation. */
function withSession(args: Document, session: ClientSession | undefined) {
  return session ? { ...args, options: { ...args.options, session } } : args
}

/** The result a hook returns, if it returns one: `null` is a result, as `findOne` gives. */
function resultOf(returned: unknown): { result: unknown } | undefined {
  return isPlainObject(returned) && 'result' in returned ? { result: returned.result } : undefined
}

/** The arguments a `before` returns, if it returns them. */
function argsOf(returned: unknown): Document | undefined {
  return isPlainObject(returned) && isPlainObject(returned.args) ? returned.args : undefined
}

/**
 * Runs an operation through the plugins of its model, in layers: the first plugin wraps the rest.
 * Each plugin runs its middleware around its `before` hooks, the next layers and its `after` hooks.
 * A `before` that returns `{ result }` skips the next layers and the operation, and the `after`
 * hooks of its plugin and the previous ones still run.
 *
 * A hook's result is trusted to have the type of its operation, a known limit of the contract:
 * plugins see documents as `Document`.
 */
export function runOperation<R>(
  pipeline: Pipeline,
  operation: Operation,
  args: Document,
  run: (args: Document) => Promise<R>
): Promise<R>
export async function runOperation(
  { model, plugins }: Pipeline,
  operation: Operation,
  args: Document,
  run: (args: Document) => Promise<unknown>
): Promise<unknown> {
  if (plugins.length === 0) return run(forCore(plugins, operation, args))

  const prepared = prepare(plugins, operation, args)

  async function layer(index: number, current: Document): Promise<unknown> {
    const plugin = plugins[index]

    if (!plugin) return run(forCore(plugins, operation, current))

    const input = { context: prepared.contexts[index], model, operation }
    const hooks = hooksOf(plugin, operation)

    async function step(stepArgs: Document) {
      let next = stepArgs
      let skipped: { result: unknown } | undefined

      for (const hook of hooks) {
        const returned = await hook.before?.({ ...input, args: next })

        skipped = resultOf(returned)

        if (skipped) break

        next = argsOf(returned) ?? next
      }

      let result = skipped ? skipped.result : await layer(index + 1, next)

      for (const hook of hooks.toReversed()) {
        const replaced = resultOf(await hook.after?.({ ...input, args: next, result }))

        if (replaced) result = replaced.result
      }

      return result
    }

    if (!plugin.middleware) return step(current)

    return plugin.middleware({
      ...input,
      args: current,
      next: (nextOptions?: { session?: ClientSession }) =>
        step(withSession(current, nextOptions?.session))
    })
  }

  return layer(0, prepared.args)
}

/** The batches of a cursor, as the core reads them from the server. */
export interface BatchSource<T> {
  /** Reads the next batch, processed, and fetches it from the server when it has to. */
  next(): Promise<T[]>

  /** Whether the server has no batch left. */
  readonly done: boolean

  /** Frees the cursor on the server. */
  close(): Promise<void>
}

/**
 * Runs `find` or `aggregate` through the plugins: their `before` hooks run once, when the cursor
 * starts, because they fix the query; their middleware and `after` hooks run once per batch the
 * server returns. The documents are trusted to have the type the cursor gives them, like a hook's
 * result.
 */
export function runCursor<T>(
  pipeline: Pipeline,
  operation: 'aggregate' | 'find',
  args: Document,
  open: (args: Document) => BatchSource<unknown>
): AsyncGenerator<T[], void, void>
export async function* runCursor(
  { model, plugins }: Pipeline,
  operation: 'aggregate' | 'find',
  args: Document,
  open: (args: Document) => BatchSource<unknown>
): AsyncGenerator<unknown[], void, void> {
  const prepared = plugins.length > 0 ? prepare(plugins, operation, args) : { args, contexts: [] }
  let current = prepared.args
  let skipped: { index: number; result: unknown } | undefined

  for (const [index, plugin] of plugins.entries()) {
    const input = { context: prepared.contexts[index], model, operation }

    for (const hook of hooksOf(plugin, operation)) {
      const returned = await hook.before?.({ ...input, args: current })
      const result = resultOf(returned)

      if (result) {
        skipped = { index, result: result.result }

        break
      }

      current = argsOf(returned) ?? current
    }

    if (skipped) break
  }

  const layers = skipped ? plugins.slice(0, skipped.index + 1) : plugins

  /** One batch through the middleware and the `after` hooks, from the last layer to the first. */
  function batch(read: () => Promise<unknown>) {
    return layers.reduceRight<() => Promise<unknown>>(
      (inner, plugin, index) => async () => {
        const input = { args: current, context: prepared.contexts[index], model, operation }

        async function step() {
          let result = await inner()

          for (const hook of hooksOf(plugin, operation).toReversed()) {
            const replaced = resultOf(await hook.after?.({ ...input, result }))

            if (replaced) result = replaced.result
          }

          return result
        }

        // A cursor keeps the session it starts with, so `next()` takes no other.
        return plugin.middleware ? plugin.middleware({ ...input, next: step }) : step()
      },
      read
    )()
  }

  if (skipped) {
    const { result } = skipped
    const documents = await batch(() => Promise.resolve(result))

    yield Array.isArray(documents) ? documents : []

    return
  }

  const source = open(forCore(plugins, operation, current))

  try {
    do {
      const documents = await batch(() => source.next())

      yield Array.isArray(documents) ? documents : []
    } while (!source.done)
  } finally {
    await source.close()
  }
}
