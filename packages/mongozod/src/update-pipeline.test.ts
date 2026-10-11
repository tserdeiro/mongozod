import { MongoClient, MongoServerError } from 'mongodb'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from 'vitest'
import { z } from 'zod'

import { date } from './codecs/date'
import { mongozod } from './mongozod'
import { softDelete } from './plugins/soft-delete'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-update-pipeline')

beforeAll(() => client.connect())
afterAll(() => client.close())
beforeEach(() => db.dropDatabase())

const orderSchema = z.object({
  _id: z.string(),
  createdAt: date(),
  deletedAt: date().optional(),
  price: z.number(),
  tax: z.number(),
  total: z.number().optional(),
  updatedAt: date()
})

const OrdersModel = mongozod({
  collection: 'orders',
  db,
  plugins: [softDelete()],
  schema: orderSchema,
  timestamps: true
})

const total = [{ $set: { total: { $add: ['$price', '$tax'] } } }]

const source = new Date('2020-01-01T00:00:00Z')

describe('a pipeline update', () => {
  test('computes from other fields with updatePipeline: true', async () => {
    await OrdersModel.insertOne({ _id: 'o1', price: 100, tax: 21 })
    await OrdersModel.updateOne({ _id: 'o1' }, total, { updatePipeline: true })

    expect(await OrdersModel.findOne({ _id: 'o1' })).toMatchObject({ total: 121 })
  })

  test('needs updatePipeline: true', async () => {
    await expect(
      // @ts-expect-error a pipeline needs updatePipeline: true
      OrdersModel.updateOne({ _id: 'o1' }, total)
    ).rejects.toMatchObject({
      issues: [{ message: 'an update with a pipeline needs updatePipeline: true' }]
    })
  })

  test('takes only the stages MongoDB takes in an update, which the server checks', async () => {
    await OrdersModel.insertOne({ _id: 'o1', price: 100, tax: 21 })

    await expect(
      OrdersModel.updateOne(
        { _id: 'o1' },
        // @ts-expect-error $match is not a stage of an update pipeline
        [{ $match: { price: 100 } }],
        { updatePipeline: true }
      )
    ).rejects.toBeInstanceOf(MongoServerError)
  })

  test('stamps updatedAt, and createdAt only when an upsert inserts', async () => {
    await OrdersModel.insertOne({ _id: 'o1', createdAt: source, price: 100, tax: 21 })
    await OrdersModel.updateOne({ _id: 'o1' }, total, { updatePipeline: true, upsert: true })
    await OrdersModel.updateOne({ _id: 'o2' }, [{ $set: { price: 10, tax: 0 } }], {
      updatePipeline: true,
      upsert: true
    })

    const [existing, inserted] = await OrdersModel.find({}).sort({ _id: 1 })

    expect(existing?.createdAt).toEqual(source)
    expect(existing?.updatedAt.getTime()).toBeGreaterThan(source.getTime())
    expect(inserted?.createdAt).toEqual(inserted?.updatedAt)
  })

  test('goes through the plugins: softDelete leaves the deleted documents alone', async () => {
    await OrdersModel.insertMany([
      { _id: 'o1', price: 100, tax: 21 },
      { _id: 'o2', deletedAt: new Date(), price: 10, tax: 0 }
    ])

    const result = await OrdersModel.updateMany({}, total, { updatePipeline: true })

    expect(result.modifiedCount).toBe(1)
    expect(
      await db.collection<{ _id: string }>('orders').findOne({ _id: 'o2' })
    ).not.toHaveProperty('total')
  })

  test('works in findOneAndUpdate and bulkWrite', async () => {
    await OrdersModel.insertMany([
      { _id: 'o1', price: 100, tax: 21 },
      { _id: 'o2', price: 10, tax: 0 }
    ])

    const updated = await OrdersModel.findOneAndUpdate({ _id: 'o1' }, total, {
      returnDocument: 'after',
      updatePipeline: true
    })

    await OrdersModel.bulkWrite([{ updateOne: { filter: { _id: 'o2' }, update: total } }], {
      updatePipeline: true
    })

    expect(updated).toMatchObject({ total: 121 })
    expect(await OrdersModel.findOne({ _id: 'o2' })).toMatchObject({ total: 10 })
    await expect(
      // @ts-expect-error a pipeline needs updatePipeline: true
      OrdersModel.bulkWrite([{ updateOne: { filter: { _id: 'o2' }, update: total } }])
    ).rejects.toBeInstanceOf(z.ZodError)
  })
})
