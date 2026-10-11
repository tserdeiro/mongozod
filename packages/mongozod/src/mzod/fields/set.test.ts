import { MongoClient, ObjectId } from 'mongodb'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  inject,
  test
} from 'vitest'
import { z } from 'zod'

import { toJsonSchema } from '../../model/json-schema'
import { mongozod } from '../../mongozod'
import { isSet } from '../../schema/schema-kinds'

import { objectId } from './bson'
import { set } from './set'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-fields-set')

beforeAll(() => client.connect())
afterAll(() => client.close())
beforeEach(() => db.dropDatabase())

const postSchema = z.object({
  _id: z.string(),
  editors: set(objectId()).default([]),
  sections: z.array(z.object({ _id: z.string(), labels: set(z.string()).default([]) })).default([]),
  tags: set(z.string()).default([])
})

describe('set()', () => {
  test('takes an array that keeps each value once, and returns it', () => {
    const schema = set(z.string())

    expect(schema.parse(['a', 'b', 'A'])).toEqual(['a', 'b', 'A'])
    expect(schema.safeParse(['a', 'b', 'a']).error?.issues).toMatchObject([
      { message: 'is repeated: a set keeps each value once', path: [2] }
    ])
    expectTypeOf<z.input<typeof schema>>().toEqualTypeOf<string[]>()
    expectTypeOf<z.output<typeof schema>>().toEqualTypeOf<string[]>()
  })

  test("compares as MongoDB's uniqueItems: by value, and objects in any field order", () => {
    const id = new ObjectId()
    const repeated = [
      [1, 1.0],
      [new Date(0), new Date(0)],
      [
        { a: 1, b: 2 },
        { b: 2, a: 1 }
      ],
      [
        [1, 2],
        [1, 2]
      ]
    ]

    for (const values of repeated) expect(set(z.unknown()).safeParse(values).success).toBe(false)

    // The elements are parsed first: a hex string and the ObjectId it decodes to are the same.
    expect(set(objectId()).safeParse([id, id.toHexString()]).success).toBe(false)
    expect(set(z.unknown()).safeParse([{ a: null }, {}, 'a', 'A', [1, 2], [2, 1]]).success).toBe(
      true
    )
  })

  test('stays a set through clones and wrappers', () => {
    for (const schema of [
      set(z.string()).min(1),
      set(z.string()).optional(),
      set(z.string()).default([]),
      set(z.string()).nullable()
    ]) {
      expect(isSet(schema)).toBe(true)
      expect(schema.safeParse(['a', 'a']).success).toBe(false)
    }

    expect(isSet(z.array(z.string()))).toBe(false)
  })

  test('encodes to an array, and has uniqueItems in the $jsonSchema', () => {
    const id = new ObjectId()

    expect(z.encode(set(objectId()), [id])).toEqual([id.toHexString()])
    expect(toJsonSchema(postSchema).properties.tags).toEqual({
      bsonType: 'array',
      items: { bsonType: 'string' },
      uniqueItems: true
    })
  })
})

describe('in a model', () => {
  const PostsModel = mongozod({ collection: 'posts', db, jsonSchema: true, schema: postSchema })

  test('rejects a repeated value in a write', async () => {
    await expect(PostsModel.insertOne({ _id: 'p1', tags: ['a', 'a'] })).rejects.toBeInstanceOf(
      z.ZodError
    )
    await PostsModel.insertOne({ _id: 'p1', tags: ['a'] })
    await expect(
      PostsModel.updateOne({ _id: 'p1' }, { $set: { tags: ['b', 'b'] } })
    ).rejects.toBeInstanceOf(z.ZodError)
  })

  test('adds with $addToSet and removes with $pull, $pullAll or $pop', async () => {
    await PostsModel.insertOne({ _id: 'p1', sections: [{ _id: 's1', labels: ['x'] }], tags: ['a'] })
    await PostsModel.updateOne(
      { _id: 'p1' },
      { $addToSet: { 'sections.$[s].labels': 'y', 'tags': { $each: ['a', 'b'] } } },
      { arrayFilters: [{ 's._id': 's1' }] }
    )
    await PostsModel.updateOne({ _id: 'p1' }, { $pull: { tags: 'a' } })

    expect(await PostsModel.findOne({ _id: 'p1' })).toMatchObject({
      sections: [{ labels: ['x', 'y'] }],
      tags: ['b']
    })
  })

  test('does not take $push, nor a write to one of its elements', async () => {
    await PostsModel.insertOne({ _id: 'p1', sections: [{ _id: 's1' }], tags: ['a'] })

    const rejected = [
      // @ts-expect-error "tags" is a set: use $addToSet
      PostsModel.updateOne({ _id: 'p1' }, { $push: { tags: 'a' } }),
      // @ts-expect-error "tags" is a set: write it whole, or use $addToSet, $pull, $pullAll or $pop
      PostsModel.updateOne({ _id: 'p1' }, { $set: { 'tags.0': 'b' } }),
      PostsModel.updateOne(
        { '_id': 'p1', 'sections._id': 's1' },
        // @ts-expect-error "sections.$.labels" is a set: write it whole, or use $addToSet…
        { $set: { 'sections.$.labels.$[]': 'b' } }
      )
    ]

    await Promise.all(rejected.map((update) => expect(update).rejects.toBeInstanceOf(z.ZodError)))
  })

  test('the $jsonSchema of sync() makes the server reject a repeated value too', async () => {
    await PostsModel.sync()
    await PostsModel.insertOne({ _id: 'p1', tags: ['a'] })

    await expect(
      db
        .collection<{ _id: string; tags: string[] }>('posts')
        .updateOne({ _id: 'p1' }, { $push: { tags: 'a' } })
    ).rejects.toMatchObject({ code: 121 })
  })
})
