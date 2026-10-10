// Compiles against the published declarations, as a project that installs mongozod would.
import type { ModelFilter } from 'mongozod'

import { MongoClient } from 'mongodb'
import { mongozod } from 'mongozod'
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

const NotesModel = mongozod({ collection: 'notes', db, schema: noteSchema })

const EventsModel = mongozod({
  collection: 'events',
  db,
  schema: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('click'), url: z.url() }),
    z.object({ kind: z.literal('view'), seconds: z.number() })
  ])
})

const timestampSchema = z
  .union([z.date(), z.iso.datetime().transform((value) => new Date(value))])
  .default(() => new Date())

const PostsModel = mongozod({
  collection: 'posts',
  db,
  schema: z.object({ createdAt: timestampSchema, title: z.string(), updatedAt: timestampSchema }),
  timestamps: true
})

/** A service that forwards a filter to the model keeps its checks. */
function countNotes<const F extends ModelFilter<typeof noteSchema, F>>(filter: F) {
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

  return { counts, distinctTags, tags, titles, total }
}
