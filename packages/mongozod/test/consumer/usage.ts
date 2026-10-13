// Compiles against the published declarations, as a project that installs mongozod would.
import type { AnyModel, FilterOf, ReadOptionsArg } from 'mongozod'

import { Decimal128, ObjectId } from 'bson'
import { MongoClient } from 'mongodb'
import { definePlugin, mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import { softDelete } from 'mongozod/plugins/soft-delete'
import { z } from 'zod'

const db = new MongoClient('mongodb://localhost').db()

const noteSchema = z.object({
  _id: z.uuidv4().default(() => crypto.randomUUID()),
  author: z.object({ name: z.string() }).optional(),
  connections: z
    .array(z.object({ _id: z.string(), enabled: z.boolean(), syncedAt: z.date().optional() }))
    .default([]),
  createdAt: z.union([z.date(), z.iso.datetime().transform((value) => new Date(value))]),
  tags: z.array(z.string()).default([]),
  title: z.string().min(1),
  views: z.number().int().default(0)
})

const NotesModel = mongozod({
  collection: 'notes',
  db,
  indexes: (index) => [
    index({ 'author.name': 1, 'createdAt': -1 }),
    index({ title: 1 }, { partialFilterExpression: { views: { $gt: 0 } }, unique: true })
  ],
  jsonSchema: { validationLevel: 'moderate' },
  schema: noteSchema
})

const EventsModel = mongozod({
  collection: 'events',
  db,
  schema: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('click'), url: z.url() }),
    z.object({ kind: z.literal('view'), seconds: z.number() })
  ])
})

const timestampSchema = mz.date()

const PostsModel = mongozod({
  collection: 'posts',
  db,
  schema: z.object({ createdAt: timestampSchema, title: z.string(), updatedAt: timestampSchema }),
  timestamps: true
})

const accountSchema = z.object({
  _id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  parent: z.string().optional()
})

// Two models that reference each other, and one that references itself.
const AccountsModel = mongozod({
  collection: 'accounts',
  db,
  references: { parent: () => AccountsModel },
  schema: accountSchema,
  virtuals: {
    fullName: accountSchema
      .pick({ firstName: true, lastName: true })
      .transform((account) => `${account.firstName} ${account.lastName}`)
  }
})

const TransactionsModel = mongozod({
  collection: 'transactions',
  db,
  references: {
    approvedBy: () => AccountsModel,
    createdBy: () => AccountsModel,
    organization: {
      collection: 'organizations',
      schema: z.object({ _id: z.string(), name: z.string() })
    }
  },
  schema: z.object({
    _id: z.string(),
    approvedBy: z.array(z.string()),
    createdBy: z.string(),
    organization: z.string()
  })
})

const actor = z.object({ actor: z.string() })

/** Stamps who writes, and adds a method typed by each model. */
const audit = definePlugin({
  context: { delete: actor, insert: actor, update: actor },
  hooks: {
    insertOne: {
      before: ({ args, context }) => ({
        args: { ...args, document: { ...args.document, createdBy: context.actor } }
      })
    }
  },
  id: 'audit',
  methods: {
    async exists<M extends AnyModel, const F extends FilterOf<M, F>>(
      this: M,
      filter: F,
      ...options: ReadOptionsArg<M>
    ) {
      return (await this.countDocuments(filter, { ...options[0], limit: 1 })) > 0
    }
  }
})

const TasksModel = mongozod({
  collection: 'tasks',
  db,
  plugins: [softDelete(), audit],
  schema: z.object({
    createdBy: z.string().optional(),
    deletedAt: z.date().optional(),
    title: z.string()
  })
})

// @ts-expect-error softDelete needs deletedAt in the schema
mongozod({
  collection: 'plain',
  db,
  plugins: [softDelete()],
  schema: z.object({ title: z.string() })
})

// A validations file: it keeps its own z and adds mz, which never imports the driver.
const listNotesSchema = z.object({
  after: mz.after(noteSchema, { createdAt: -1, _id: -1 }).default({}),
  filter: mz
    .filter(noteSchema, { '_id': ['$eq', '$in'], 'author.name': ['$eq'], 'tags': ['$all', '$eq'] })
    .default({}),
  limit: z.number().int().min(1).max(100).default(20),
  projection: mz.projection(noteSchema, { tags: true, title: true }),
  sort: mz.sort(noteSchema, { title: true, views: true }).default({ views: -1 })
})

const updateNoteSchema = z.object({
  filter: mz.filter(noteSchema, { _id: ['$eq'] }).required({ _id: true }),
  update: mz.update(noteSchema, { $inc: ['views'], $set: ['title'], $unset: ['author'] })
})

const findTransactionSchema = z.object({
  filter: mz.filter(z.object({ _id: z.string() }), { _id: ['$eq'] }).required({ _id: true }),
  populate: mz
    .populate({
      organization: z.object({ _id: z.string(), name: z.string() }).pick({ name: true })
    })
    .optional()
})

/** A service that forwards a filter to the model keeps its checks. */
function countNotes<const F extends FilterOf<typeof NotesModel, F>>(filter: F) {
  return NotesModel.countDocuments(filter)
}

export async function usage() {
  const { document } = await NotesModel.insertOne({
    createdAt: '2026-10-10T12:00:00Z',
    title: 'Notes'
  })
  const id: string = document._id

  const titles: Array<{ title: string }> = await NotesModel.find({
    'author.name': 'Ana',
    'views': { $gte: 1 }
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .project({ _id: 0, title: 1 })

  const note = await NotesModel.findOne({ _id: id }, { projection: { tags: 1 } })
  const tags: string[] | undefined = note?.tags

  await NotesModel.updateOne(
    { _id: id },
    { $inc: { views: 1 }, $set: { 'connections.$[c].enabled': true } },
    { arrayFilters: [{ 'c._id': 'c' }] }
  )
  await EventsModel.updateOne({ kind: 'click' }, { $set: { url: 'https://example.com' } })

  const distinctTags: string[] = await NotesModel.distinct('tags')
  const counts = await NotesModel.aggregate(
    [{ $match: { title: 'Notes' } }, { $group: { _id: '$title', n: { $sum: 1 } } }],
    {
      schema: z.object({ _id: z.string(), n: z.number() })
    }
  )
  const total: number = await countNotes({ tags: 'home' })

  // @ts-expect-error a title is a string
  await NotesModel.find({ title: 1 })
  // @ts-expect-error "titel" is not a path of the document
  await NotesModel.updateOne({}, { $set: { titel: 'x' } })
  // @ts-expect-error $[c] needs arrayFilters
  await NotesModel.updateMany({}, { $set: { 'connections.$[c].enabled': true } })
  // @ts-expect-error without fixing "kind", a view could get a url
  await EventsModel.updateOne({}, { $set: { url: 'https://example.com' } })
  // @ts-expect-error an index is a field name for a projection
  await NotesModel.find({}, { projection: { 'connections.0.enabled': 1 } })
  await PostsModel.insertOne({ title: 'Post' })
  await PostsModel.updateOne(
    { title: 'Post' },
    { $set: { updatedAt: new Date() } },
    { timestamps: false }
  )
  // @ts-expect-error updatedAt is set by timestamps
  await PostsModel.updateOne({ title: 'Post' }, { $set: { updatedAt: new Date() } })
  // @ts-expect-error "title" is required
  await NotesModel.insertOne({ createdAt: new Date() })

  const [transaction] = await TransactionsModel.find(
    {},
    {
      populate: {
        approvedBy: { projection: { fullName: 1 } },
        createdBy: true,
        organization: { projection: { name: 1 } }
      }
    }
  )
  const approvers: Array<{ _id: string; fullName: string }> | undefined = transaction?.approvedBy
  const creator: string | null | undefined = transaction?.createdBy?.fullName
  const names = await AccountsModel.find({}, { projection: { fullName: 1 } })
  const fullName: string | undefined = names[0]?.fullName

  // @ts-expect-error firstName was not asked for
  const firstName: string | undefined = names[0]?.firstName
  // @ts-expect-error a virtual is not stored
  await AccountsModel.find({ fullName: 'Ana Gómez' })
  // @ts-expect-error amount is not a reference
  await TransactionsModel.find({}, { populate: { amount: true } })

  await TasksModel.insertOne({ title: 'Task' }, { context: { actor: 'ana' } })
  await TasksModel.deleteOne({ title: 'Task' }, { context: { actor: 'ana' } })
  const trash = await TasksModel.find({ deletedAt: { $exists: true } })
  // @ts-expect-error the writes of TasksModel need who makes them
  await TasksModel.insertOne({ title: 'Task' })
  const taskExists: boolean = await TasksModel.exists({ title: 'Task' })
  // @ts-expect-error a title is a string
  await TasksModel.exists({ title: 1 })

  const list = listNotesSchema.parse({ filter: { tags: { $all: ['home'] } } })
  const page = await NotesModel.find(
    { $and: [list.filter, list.after] },
    { limit: list.limit, projection: list.projection, sort: list.sort }
  )
  const edit = updateNoteSchema.parse({ filter: { _id: id }, update: { $set: { title: 'New' } } })
  await NotesModel.updateOne(edit.filter, edit.update)
  const lookup = findTransactionSchema.parse({
    filter: { _id: 't1' },
    populate: { organization: true }
  })
  const found = await TransactionsModel.findOne(lookup.filter, { populate: lookup.populate })
  const organization: string | { name?: string } | null | undefined = found?.organization

  // @ts-expect-error "titel" is not a path of the document
  mz.filter(noteSchema, { titel: ['$eq'] })
  // @ts-expect-error "title" is required, so it cannot be unset
  mz.update(noteSchema, { $unset: ['title'] })

  const { extraIndexes, indexes } = await NotesModel.sync()
  const legacy: Array<string | undefined> = extraIndexes.map((index) => index.name)

  mongozod({
    collection: 'notes',
    db,
    // @ts-expect-error "titel" is not a path of the document
    indexes: (index) => [index({ titel: 1 })],
    schema: noteSchema
  })

  return {
    approvers,
    organization,
    page,
    taskExists,
    trash,
    counts,
    indexes,
    legacy,
    creator,
    distinctTags,
    firstName,
    fullName,
    tags,
    titles,
    total
  }
}

const brandSchema = z.object({
  _id: mz.objectId().default(() => new ObjectId()),
  budget: z.instanceof(Decimal128).meta({ bsonType: 'decimal' }).optional(),
  fee: mz.decimal128().optional(),
  logo: mz.binary().optional(),
  office: mz.point().optional(),
  launchedAt: mz.date().optional(),
  owner: mz.objectId().optional(),
  sessionId: mz.uuid().optional(),
  tags: mz.set(z.string()).default([])
})

export async function brands() {
  const BrandsModel = mongozod({ collection: 'brands', db, schema: brandSchema })
  const { document } = await BrandsModel.insertOne({ owner: '65c3b9b4f1d2a34b5c6d7e8f' })
  const owner: ObjectId | undefined = document.owner
  const launchedAt: Date | undefined = document.launchedAt
  const sessionId: string | undefined = document.sessionId?.toHexString()

  await BrandsModel.updateOne(
    { _id: document._id },
    { $set: { launchedAt: '2026-10-01T10:00:00Z' } }
  )
  const byId = mz.filter(brandSchema, { _id: ['$eq', '$in'] })

  // @ts-expect-error a number is not an ObjectId
  await BrandsModel.insertOne({ owner: 42 })
  await BrandsModel.updateOne({ _id: document._id }, { $addToSet: { tags: 'new' } })
  // @ts-expect-error a set takes $addToSet, not $push
  await BrandsModel.updateOne({ _id: document._id }, { $push: { tags: 'new' } })

  return {
    found: await BrandsModel.findOne({ _id: document._id }),
    launchedAt,
    owner,
    byId,
    sessionId
  }
}

// @ts-expect-error decimel is not a BSON type
z.unknown().meta({ bsonType: 'decimel' })
