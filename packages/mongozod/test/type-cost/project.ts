// A typical project: the models of an app, with the reads, writes and endpoint inputs it makes.
// `check-type-cost` measures what compiling it costs, which is what the editor pays.
import type { DocOf, ReadOf } from 'mongozod'

import { MongoClient } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import { softDelete } from 'mongozod/plugins/soft-delete'
import { z } from 'zod'

const db = new MongoClient('mongodb://localhost').db()

const organizationSchema = z.object({ _id: z.string(), name: z.string(), slug: z.string() })

const accountSchema = z.object({
  _id: z.string(),
  createdAt: z.date(),
  email: z.email(),
  firstName: z.string(),
  lastName: z.string(),
  organization: z.string(),
  updatedAt: z.date()
})

const AccountsModel = mongozod({
  collection: 'accounts',
  db,
  references: { organization: { collection: 'organizations', schema: organizationSchema } },
  schema: accountSchema,
  timestamps: true,
  virtuals: {
    fullName: accountSchema
      .pick({ firstName: true, lastName: true })
      .transform((account) => `${account.firstName} ${account.lastName}`)
  }
})

const connectionSchema = z.object({
  _id: z.string(),
  accounts: z
    .array(
      z.object({
        _id: z.string(),
        details: z.discriminatedUnion('plugin', [
          z.object({ loginCustomerId: z.string().optional(), plugin: z.literal('google-ads') }),
          z.object({ plugin: z.literal('meta-ads'), pixelId: z.string() })
        ]),
        enabled: z.boolean().default(true)
      })
    )
    .default([]),
  status: z.enum(['active', 'expired']),
  syncedAt: mz.date().optional()
})

const pluginSchema = z.object({
  _id: z.uuidv4().default(() => crypto.randomUUID()),
  budget: mz.decimal128().optional(),
  connections: z.array(connectionSchema).default([]),
  createdAt: z.date(),
  createdBy: z.string(),
  deletedAt: z.date().optional(),
  location: mz.point().optional(),
  metadata: z.record(z.string(), z.string()).default({}),
  name: z.string().min(1),
  organization: z.string(),
  tags: z.array(z.string()).default([]),
  updatedAt: z.date(),
  views: z.number().int().default(0)
})

const PluginsModel = mongozod({
  collection: 'plugins',
  db,
  indexes: (index) => [index({ organization: 1, createdAt: -1 }), index({ 'connections._id': 1 })],
  plugins: [softDelete()],
  references: {
    createdBy: () => AccountsModel,
    organization: { collection: 'organizations', schema: organizationSchema }
  },
  schema: pluginSchema,
  timestamps: true
})

const eventSchema = z.discriminatedUnion('kind', [
  z.object({ at: z.date(), kind: z.literal('click'), plugin: z.string(), url: z.url() }),
  z.object({ at: z.date(), kind: z.literal('view'), plugin: z.string(), seconds: z.number() })
])

const EventsModel = mongozod({
  collection: 'events',
  db,
  references: { plugin: () => PluginsModel },
  schema: eventSchema
})

// The inputs of the endpoints.
const listPluginsInput = z.object({
  after: mz.after(pluginSchema, { createdAt: -1, _id: -1 }).default({}),
  filter: mz
    .filter(pluginSchema, {
      'connections.status': ['$eq', '$in'],
      'name': ['$regex'],
      'organization': ['$eq'],
      'tags': ['$all', '$in']
    })
    .default({}),
  limit: z.number().int().min(1).max(100).default(20),
  populate: mz.populate({ createdBy: accountSchema.pick({ email: true }) }).optional(),
  projection: mz.projection(pluginSchema, { connections: true, name: true, tags: true }),
  sort: mz.sort(pluginSchema, { createdAt: true, name: true }).default({ createdAt: -1 })
})

const updatePluginInput = z.object({
  filter: mz.filter(pluginSchema, { _id: ['$eq'] }).required({ _id: true }),
  update: mz.update(pluginSchema, {
    $inc: ['views'],
    $set: ['name', 'budget', 'location'],
    $unset: ['budget']
  })
})

export async function listPlugins(input: unknown) {
  const { after, filter, limit, populate, projection, sort } = listPluginsInput.parse(input)

  return PluginsModel.find({ $and: [filter, after] }, { limit, populate, projection, sort })
}

export async function updatePlugin(input: unknown, actor: string) {
  const { filter, update } = updatePluginInput.parse(input)

  return PluginsModel.updateOne({ ...filter, createdBy: actor }, update)
}

export async function pluginDetails(id: string) {
  const plugin = await PluginsModel.findOne(
    { _id: id },
    {
      populate: { createdBy: { projection: { email: 1, fullName: 1 } }, organization: true },
      projection: {
        'connections.accounts.details': 1,
        'connections.status': 1,
        'createdBy': 1,
        'name': 1,
        'organization': 1
      }
    }
  )

  return (
    plugin && {
      name: plugin.name,
      owner: plugin.createdBy,
      statuses: plugin.connections.map((c) => c.status)
    }
  )
}

export async function syncConnection(pluginId: string, connectionId: string) {
  await PluginsModel.updateOne(
    { '_id': pluginId, 'connections._id': connectionId },
    { $currentDate: { 'connections.$.syncedAt': true }, $set: { 'connections.$.status': 'active' } }
  )
  await PluginsModel.updateOne(
    { _id: pluginId },
    { $set: { 'connections.$[c].accounts.$[a].details.loginCustomerId': '1234567890' } },
    { arrayFilters: [{ 'c._id': connectionId }, { 'a.details.plugin': 'google-ads' }] }
  )
}

export async function createPlugin(name: string, organization: string, createdBy: string) {
  const { document } = await PluginsModel.insertOne({ createdBy, name, organization })

  await EventsModel.insertMany([
    { at: new Date(), kind: 'view', plugin: document._id, seconds: 3 },
    { at: new Date(), kind: 'click', plugin: document._id, url: 'https://example.com' }
  ])

  return document
}

export async function report(organization: string) {
  const views = await EventsModel.aggregate([
    { $match: { at: { $gte: new Date(Date.now() - 86_400_000) }, kind: 'view' } },
    { $group: { _id: '$plugin', seconds: { $sum: '$seconds' } } },
    { $sort: { seconds: -1 } }
  ])
  const tags = await PluginsModel.distinct('tags', { organization })
  const total = await PluginsModel.countDocuments({ organization, views: { $gt: 0 } })
  const accounts = await AccountsModel.find(
    { createdAt: { $gte: new Date(0) }, organization },
    { populate: { organization: { projection: { name: 1 } } }, sort: { lastName: 1 } }
  )

  await PluginsModel.deleteOne({ name: { $regex: '^tmp-' }, organization })

  return { accounts, tags, total, views }
}

// What an app does with what it reads: array methods infer from the documents, through the virtuals
// and the references of their models.
export function names(
  accounts: Array<ReadOf<typeof AccountsModel, { populate: { organization: true } }>>,
  plugins: Array<DocOf<typeof PluginsModel>>
) {
  return {
    accounts: accounts.map((account) => `${account.fullName} (${account.organization?.name})`),
    plugins: plugins.filter((plugin) => plugin.views > 0).map((plugin) => plugin.name)
  }
}
