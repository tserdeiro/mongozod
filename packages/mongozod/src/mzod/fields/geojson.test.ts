import { MongoClient } from 'mongodb'
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

import {
  geometryCollection,
  lineString,
  multiLineString,
  multiPoint,
  multiPolygon,
  point,
  polygon
} from './geojson'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-geojson')

beforeAll(() => client.connect())
afterAll(() => client.close())
beforeEach(() => db.dropDatabase())

const triangle = [
  [0, 0],
  [3, 6],
  [6, 1],
  [0, 0]
]

function messages(schema: z.ZodType, value: unknown) {
  return schema.safeParse(value).error?.issues.map((issue) => issue.message) ?? []
}

describe('the geometries', () => {
  test('take GeoJSON as MongoDB stores it, with an optional altitude', () => {
    expect(point().parse({ coordinates: [-58.38, -34.6], type: 'Point' })).toEqual({
      coordinates: [-58.38, -34.6],
      type: 'Point'
    })
    expect(point().parse({ coordinates: [-58.38, -34.6, 25], type: 'Point' }).coordinates).toEqual([
      -58.38, -34.6, 25
    ])
    expect(
      lineString().safeParse({
        coordinates: [
          [0, 0],
          [1, 1]
        ],
        type: 'LineString'
      }).success
    ).toBe(true)
    expect(polygon().safeParse({ coordinates: [triangle], type: 'Polygon' }).success).toBe(true)
    expect(multiPoint().safeParse({ coordinates: [[0, 0]], type: 'MultiPoint' }).success).toBe(true)
    expect(
      multiLineString().safeParse({
        coordinates: [
          [
            [0, 0],
            [1, 1]
          ]
        ],
        type: 'MultiLineString'
      }).success
    ).toBe(true)
    expect(
      multiPolygon().safeParse({ coordinates: [[triangle]], type: 'MultiPolygon' }).success
    ).toBe(true)
    expectTypeOf<z.output<ReturnType<typeof point>>>().toEqualTypeOf<{
      coordinates: [number, number, (number | undefined)?]
      type: 'Point'
    }>()
  })

  test('reject what MongoDB rejects with a 2dsphere index, and store without one', () => {
    expect(messages(point(), { coordinates: [181, 0], type: 'Point' })).toEqual([
      'longitude goes from -180 to 180'
    ])
    expect(messages(point(), { coordinates: [0, -91], type: 'Point' })).toEqual([
      'latitude goes from -90 to 90'
    ])
    expect(
      messages(lineString(), {
        coordinates: [
          [0, 0],
          [0, 0]
        ],
        type: 'LineString'
      })
    ).toEqual(['a line has 2 different positions at least'])
    expect(
      messages(polygon(), {
        coordinates: [
          [
            [0, 0],
            [3, 6],
            [6, 1],
            [1, 1]
          ]
        ],
        type: 'Polygon'
      })
    ).toEqual(['a ring is closed: its last position repeats the first'])
    expect(
      messages(polygon(), {
        coordinates: [
          [
            [0, 0],
            [3, 6],
            [0, 0]
          ]
        ],
        type: 'Polygon'
      })
    ).toEqual(['a ring has 4 positions at least, the last repeating the first'])
    expect(messages(polygon(), { coordinates: [], type: 'Polygon' })).toEqual([
      'a polygon has its exterior ring'
    ])
    expect(messages(multiPoint(), { coordinates: [], type: 'MultiPoint' })).toEqual([
      'a MultiPoint has 1 position at least'
    ])
    expect(messages(point(), { coordinates: [0, 0], type: 'Polygon' })).toHaveLength(1)
  })

  test('take a GeometryCollection of the other types, not empty nor nested', () => {
    const collection = geometryCollection()
    const where = { coordinates: [0, 0], type: 'Point' }

    expect(
      collection.safeParse({
        geometries: [where, { coordinates: [triangle], type: 'Polygon' }],
        type: 'GeometryCollection'
      }).success
    ).toBe(true)
    expect(messages(collection, { geometries: [], type: 'GeometryCollection' })).toEqual([
      'a GeometryCollection has 1 geometry at least'
    ])
    expect(
      collection.safeParse({
        geometries: [{ geometries: [where], type: 'GeometryCollection' }],
        type: 'GeometryCollection'
      }).success
    ).toBe(false)
    expect(
      messages(collection, {
        geometries: [{ coordinates: [200, 0], type: 'Point' }],
        type: 'GeometryCollection'
      })
    ).toEqual(['longitude goes from -180 to 180'])
  })

  test('are objects and arrays in the $jsonSchema', () => {
    expect(toJsonSchema(z.object({ location: point() })).properties.location).toEqual({
      bsonType: 'object',
      properties: {
        coordinates: {
          additionalItems: false,
          bsonType: 'array',
          items: [{ bsonType: 'number' }, { bsonType: 'number' }, { bsonType: 'number' }]
        },
        type: { enum: ['Point'] }
      },
      required: ['coordinates', 'type']
    })
  })
})

test('a model with a 2dsphere index stores them, and finds what is near', async () => {
  const StoresModel = mongozod({
    collection: 'stores',
    db,
    indexes: (index) => [index({ location: '2dsphere' })],
    schema: z.object({ _id: z.string(), area: polygon().optional(), location: point() })
  })

  await StoresModel.sync()
  await StoresModel.insertMany([
    { _id: 'centro', location: { coordinates: [-58.38, -34.6], type: 'Point' } },
    { _id: 'rosario', location: { coordinates: [-60.64, -32.95], type: 'Point' } }
  ])

  const near = await StoresModel.find({
    location: {
      $near: { $geometry: { coordinates: [-58.4, -34.6], type: 'Point' }, $maxDistance: 10_000 }
    }
  })

  expect(near.map((store) => store._id)).toEqual(['centro'])
  await expect(
    StoresModel.insertOne({ _id: 'out', location: { coordinates: [200, 0], type: 'Point' } })
  ).rejects.toBeInstanceOf(z.ZodError)
})
