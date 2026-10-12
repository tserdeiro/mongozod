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

import { mongozod } from '../mongozod'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-virtuals')

beforeAll(() => client.connect())
afterAll(() => client.close())

/** wortise-dashboard-monorepo's accounts, with their `fullName`. */
const accountSchema = z.object({
  _id: z.string(),
  address: z.object({ city: z.string(), street: z.string() }).optional(),
  email: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  tags: z.array(z.string()).default([])
})

const AccountsModel = mongozod({
  collection: 'accounts',
  db,
  schema: accountSchema,
  virtuals: {
    city: accountSchema.pick({ address: true }).transform((account) => account.address?.city),
    fullName: accountSchema
      .pick({ firstName: true, lastName: true })
      .transform((account) => `${account.firstName ?? ''} ${account.lastName ?? ''}`.trim())
  }
})

const ana = {
  _id: 'a1',
  address: { city: 'Montevideo', street: 'Rambla' },
  email: 'ana@example.com',
  firstName: 'Ana',
  lastName: 'Gómez',
  tags: ['admin']
}

beforeEach(async () => {
  await db.dropDatabase()
  await AccountsModel.insertMany([ana, { _id: 'a2', email: 'bot@example.com' }])
})

describe('reads', () => {
  test('add every virtual to a whole document', async () => {
    const accounts = await AccountsModel.find().sort({ _id: 1 })

    expect(accounts).toEqual([
      { ...ana, city: 'Montevideo', fullName: 'Ana Gómez' },
      { _id: 'a2', city: undefined, email: 'bot@example.com', fullName: '', tags: [] }
    ])
    expectTypeOf<(typeof accounts)[number]['fullName']>().toEqualTypeOf<string>()
    expectTypeOf<(typeof accounts)[number]['city']>().toEqualTypeOf<string | undefined>()
  })

  test('compute them in findOne and in the document a findOneAnd… returns', async () => {
    const account = await AccountsModel.findOne({ _id: 'a1' })
    const updated = await AccountsModel.findOneAndUpdate(
      { _id: 'a1' },
      { $set: { lastName: 'Pérez' } },
      { projection: { fullName: 1 }, returnDocument: 'after' }
    )

    expect(account?.fullName).toBe('Ana Gómez')
    expect(updated).toEqual({ _id: 'a1', fullName: 'Ana Pérez' })
    expectTypeOf(updated).toEqualTypeOf<{ _id: string; fullName: string } | null>()
  })

  test('are computed batch by batch with for await', async () => {
    const names: string[] = []

    for await (const account of AccountsModel.find({}, { batchSize: 1 }).sort({ _id: 1 })) {
      names.push(account.fullName)
    }

    expect(names).toEqual(['Ana Gómez', ''])
  })

  test('are not part of what an insert stores', async () => {
    const { document } = await AccountsModel.insertOne({ _id: 'a3', email: 'x@example.com' })

    expect(document).not.toHaveProperty('fullName')
    expectTypeOf(document).not.toHaveProperty('fullName')
  })

  test('throw a ZodError when a stored document does not pass the virtual', async () => {
    await db
      .collection<{ _id: string; email: string; firstName: number }>('accounts')
      .insertOne({ _id: 'a4', email: 'x', firstName: 4 })

    await expect(AccountsModel.findOne({ _id: 'a4' })).rejects.toBeInstanceOf(z.ZodError)
  })
})

describe('projections', () => {
  test('that ask for one bring the fields it reads and return only what they asked for', async () => {
    const [onlyName] = await AccountsModel.find({ _id: 'a1' }, { projection: { fullName: 1 } })
    const [withEmail] = await AccountsModel.find({ _id: 'a1' }).project({ email: 1, fullName: 1 })

    const [withoutId] = await AccountsModel.find(
      { _id: 'a1' },
      { projection: { _id: 0, fullName: 1 } }
    )

    expect(withoutId).toEqual({ fullName: 'Ana Gómez' })
    expectTypeOf<NonNullable<typeof withoutId>>().toEqualTypeOf<{ fullName: string }>()
    expect(onlyName).toEqual({ _id: 'a1', fullName: 'Ana Gómez' })
    expect(withEmail).toEqual({ _id: 'a1', email: 'ana@example.com', fullName: 'Ana Gómez' })
    expectTypeOf<NonNullable<typeof onlyName>>().toEqualTypeOf<{ _id: string; fullName: string }>()
    expectTypeOf<NonNullable<typeof withEmail>>().toEqualTypeOf<{
      _id: string
      email: string
      fullName: string
    }>()
  })

  test('that ask only for one that reads the _id return only it', async () => {
    const LabeledModel = mongozod({
      collection: 'accounts',
      db,
      schema: accountSchema,
      virtuals: { label: accountSchema.pick({ _id: true }).transform(({ _id }) => `#${_id}`) }
    })
    const labeled = await LabeledModel.findOne({ _id: 'a1' }, { projection: { label: 1 } })
    const [unlabeled] = await LabeledModel.find({ _id: 'a1' }, { projection: { _id: 0, label: 1 } })

    expect(labeled).toEqual({ _id: 'a1', label: '#a1' })
    expect(unlabeled).toEqual({ label: '#a1' })
    expectTypeOf<NonNullable<typeof labeled>>().toEqualTypeOf<{ _id: string; label: string }>()
  })

  test('that exclude keep them, unless they exclude or leave out a field they read', async () => {
    const account = await AccountsModel.findOne({ _id: 'a1' }, { projection: { email: 0 } })
    const withoutName = await AccountsModel.findOne({ _id: 'a1' }, { projection: { firstName: 0 } })
    const withoutCity = await AccountsModel.findOne(
      { _id: 'a1' },
      { projection: { 'address.street': 0, 'fullName': 0 } }
    )

    expect(account).toMatchObject({ city: 'Montevideo', fullName: 'Ana Gómez' })
    expect(withoutName).not.toHaveProperty('fullName')
    expect(withoutCity).toEqual({ ...ana, address: { city: 'Montevideo' } })
    expectTypeOf<NonNullable<typeof withoutName>>().not.toHaveProperty('fullName')
    expectTypeOf<NonNullable<typeof withoutCity>>().not.toHaveProperty('city')
    expectTypeOf<NonNullable<typeof withoutCity>>().not.toHaveProperty('fullName')
  })

  test('cannot ask for one and change a field it reads', async () => {
    await expect(
      AccountsModel.find(
        { _id: 'a1' },
        // @ts-expect-error city reads the whole address
        { projection: { 'address.street': 1, 'city': 1 } }
      )
    ).rejects.toBeInstanceOf(z.ZodError)
    await expect(
      // @ts-expect-error a virtual takes 0 or 1
      AccountsModel.find({}, { projection: { fullName: { $slice: 1 } } })
    ).rejects.toThrow('is a virtual: it takes 0, 1, true or false')
  })

  test('a $meta on a field one reads changes it, as $slice does', async () => {
    await AccountsModel.collection.createIndex({ firstName: 'text' })

    const scored = await AccountsModel.findOne(
      { $text: { $search: 'Ana' } },
      { projection: { firstName: { $meta: 'textScore' } } }
    )

    expect(scored).toMatchObject({ city: 'Montevideo', firstName: expect.any(Number) })
    expect(scored).not.toHaveProperty('fullName')
    expectTypeOf<NonNullable<typeof scored>>().not.toHaveProperty('fullName')
    await expect(
      AccountsModel.find(
        { $text: { $search: 'Ana' } },
        // @ts-expect-error fullName reads firstName as stored
        { projection: { firstName: { $meta: 'textScore' }, fullName: 1 } }
      )
    ).rejects.toBeInstanceOf(z.ZodError)
  })

  test('cannot mix a virtual with an exclusion', () => {
    expectTypeOf(() =>
      // @ts-expect-error mixes inclusion and exclusion
      AccountsModel.find({}, { projection: { email: 0, fullName: 1 } })
    ).toBeFunction()
  })
})

describe('what a virtual is not', () => {
  test('a filter, a sort or a field to write', () => {
    expectTypeOf(() => [
      // @ts-expect-error a virtual is not stored
      AccountsModel.find({ fullName: 'Ana' }),
      // @ts-expect-error a virtual is not stored
      AccountsModel.find().sort({ fullName: 1 }),
      // @ts-expect-error a virtual is not stored
      AccountsModel.updateOne({ _id: 'a1' }, { $set: { fullName: 'Ana' } })
    ]).toBeFunction()
  })
})

describe('the option', () => {
  test('rejects a virtual named like a field', () => {
    expect(() =>
      mongozod({
        collection: 'accounts',
        db,
        schema: accountSchema,
        // @ts-expect-error email is a field
        virtuals: { email: accountSchema.pick({ email: true }).transform(({ email }) => email) }
      })
    ).toThrow('virtual "email" is not a valid name')
  })

  test('rejects a virtual that reads a field the document does not have, or with another type', () => {
    expect(() =>
      mongozod({
        collection: 'accounts',
        db,
        schema: accountSchema,
        virtuals: {
          // @ts-expect-error nickname is not a field
          label: z.object({ nickname: z.string() }).transform(({ nickname }) => nickname)
        }
      })
    ).toThrow('virtual "label" needs the field "nickname" in the schema')

    expectTypeOf(() =>
      mongozod({
        collection: 'accounts',
        db,
        schema: accountSchema,
        virtuals: {
          // @ts-expect-error firstName is a string
          label: z.object({ firstName: z.number() }).transform(({ firstName }) => firstName)
        }
      })
    ).toBeFunction()
  })

  test('rejects a virtual that does not take an object', () => {
    expect(() =>
      mongozod({
        collection: 'accounts',
        db,
        schema: accountSchema,
        // @ts-expect-error a virtual picks the fields it reads
        virtuals: { label: z.string().transform((value) => value) }
      })
    ).toThrow('virtual "label" must take an object')
  })

  test('needs the fields in every type of document', async () => {
    const base = z.object({ _id: z.string(), name: z.string() })
    const eventSchema = z.discriminatedUnion('kind', [
      base.extend({ kind: z.literal('click'), url: z.string() }),
      base.extend({ kind: z.literal('view') })
    ])

    expect(() =>
      mongozod({
        collection: 'events',
        db,
        schema: eventSchema,
        virtuals: {
          // @ts-expect-error a view has no url
          host: z.object({ url: z.string() }).transform(({ url }) => new URL(url).host)
        }
      })
    ).toThrow('virtual "host" needs the field "url" in the schema')

    const EventsModel = mongozod({
      collection: 'events',
      db,
      schema: eventSchema,
      virtuals: {
        label: z.object({ name: z.string() }).transform(({ name }) => name.toUpperCase())
      }
    })

    await EventsModel.insertOne({ _id: 'e1', kind: 'view', name: 'home' })

    const event = await EventsModel.findOne({ _id: 'e1' })

    expect(event).toEqual({ _id: 'e1', kind: 'view', label: 'HOME', name: 'home' })
    expectTypeOf(event).toEqualTypeOf<
      | { _id: string; kind: 'click'; label: string; name: string; url: string }
      | { _id: string; kind: 'view'; label: string; name: string }
      | null
    >()
  })
})
