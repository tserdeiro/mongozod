import type { CommandStartedEvent, WithId } from 'mongodb'

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

import { mongozod } from './mongozod'

const client = new MongoClient(inject('mongoUri'), { monitorCommands: true })
const db = client.db('mongozod-references')

beforeAll(() => client.connect())
afterAll(() => client.close())

/** Better Auth's organizations, which have no model. */
const organizationSchema = z.object({ _id: z.string(), name: z.string(), slug: z.string() })

const accountSchema = z.object({
  _id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  lastTransaction: z.string().optional()
})

const transactionSchema = z.object({
  _id: z.string(),
  amount: z.number(),
  approvers: z.array(z.string()).default([]),
  createdBy: z.string(),
  organization: z.string(),
  reviewer: z.string().nullable().optional()
})

// The two models reference each other.
const AccountsModel = mongozod({
  collection: 'accounts',
  db,
  references: { lastTransaction: () => TransactionsModel },
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
    approvers: () => AccountsModel,
    createdBy: () => AccountsModel,
    organization: { collection: 'organizations', schema: organizationSchema },
    reviewer: () => AccountsModel
  },
  schema: transactionSchema
})

interface Account {
  _id: string
  email: string
  firstName: string
  fullName: string
  lastName: string
  lastTransaction?: string
}

beforeEach(async () => {
  await db.dropDatabase()
  await db
    .collection<z.output<typeof organizationSchema>>('organizations')
    .insertOne({ _id: 'o1', name: 'Wortise', slug: 'wortise' })
  await AccountsModel.insertMany([
    { _id: 'a1', email: 'ana@example.com', firstName: 'Ana', lastName: 'Gómez' },
    { _id: 'a2', email: 'luis@example.com', firstName: 'Luis', lastName: 'Pérez' }
  ])
  await TransactionsModel.insertMany([
    { _id: 't1', amount: 10, approvers: ['a2', 'gone'], createdBy: 'a1', organization: 'o1' },
    { _id: 't2', amount: 20, createdBy: 'gone', organization: 'o1', reviewer: null }
  ])
})

describe('populate', () => {
  test("goes through the referenced model, with its virtuals: wortise's billing table", async () => {
    const transactions = await TransactionsModel.find(
      {},
      {
        populate: {
          createdBy: { projection: { fullName: 1 } },
          organization: { projection: { name: 1 } }
        }
      }
    ).sort({ _id: 1 })

    expect(transactions[0]).toMatchObject({
      createdBy: { _id: 'a1', fullName: 'Ana Gómez' },
      organization: { _id: 'o1', name: 'Wortise' }
    })
    expectTypeOf<(typeof transactions)[number]['createdBy']>().toEqualTypeOf<{
      _id: string
      fullName: string
    } | null>()
    expectTypeOf<(typeof transactions)[number]['organization']>().toEqualTypeOf<{
      _id: string
      name: string
    } | null>()
  })

  test('takes true for the whole document', async () => {
    const transaction = await TransactionsModel.findOne(
      { _id: 't1' },
      { populate: { createdBy: true, organization: true } }
    )

    expect(transaction?.createdBy).toEqual({
      _id: 'a1',
      email: 'ana@example.com',
      firstName: 'Ana',
      fullName: 'Ana Gómez',
      lastName: 'Gómez'
    })
    expect(transaction?.organization).toEqual({ _id: 'o1', name: 'Wortise', slug: 'wortise' })
    expectTypeOf<NonNullable<typeof transaction>['createdBy']>().toEqualTypeOf<Account | null>()
  })

  test('leaves null for a missing document, and keeps the ones found in an array', async () => {
    const [t1, t2] = await TransactionsModel.find(
      {},
      { populate: { approvers: { projection: { email: 1 } }, createdBy: true, reviewer: true } }
    ).sort({ _id: 1 })

    expect(t1).toMatchObject({ approvers: [{ _id: 'a2', email: 'luis@example.com' }] })
    expect(t1).not.toHaveProperty('reviewer')
    expect(t2).toMatchObject({ approvers: [], createdBy: null, reviewer: null })
    expectTypeOf<NonNullable<typeof t1>['approvers']>().toEqualTypeOf<
      Array<{ _id: string; email: string }>
    >()
    expectTypeOf<NonNullable<typeof t1>['reviewer']>().toEqualTypeOf<Account | null | undefined>()
  })

  test('a filter leaves out the documents that do not match, as null or out of the array', async () => {
    await TransactionsModel.updateOne({ _id: 't1' }, { $set: { approvers: ['a1', 'a2'] } })

    const transaction = await TransactionsModel.findOne(
      { _id: 't1' },
      {
        populate: {
          approvers: { filter: { firstName: 'Luis' } },
          createdBy: { filter: { firstName: 'Luis' } },
          organization: { filter: { _id: 'o1' }, projection: { name: 1 } }
        }
      }
    )

    expect(transaction).toMatchObject({
      approvers: [{ _id: 'a2' }],
      createdBy: null,
      organization: { _id: 'o1', name: 'Wortise' }
    })
  })

  test('a sort orders an array of references, which keeps its stored order otherwise', async () => {
    await TransactionsModel.updateOne({ _id: 't1' }, { $set: { approvers: ['a1', 'a2'] } })

    const stored = await TransactionsModel.findOne({ _id: 't1' }, { populate: { approvers: true } })
    const sorted = await TransactionsModel.findOne(
      { _id: 't1' },
      { populate: { approvers: { projection: { email: 1 }, sort: { firstName: -1 } } } }
    )

    expect(stored?.approvers.map((account) => account._id)).toEqual(['a1', 'a2'])
    expect(sorted?.approvers.map((account) => account._id)).toEqual(['a2', 'a1'])
  })

  test('checks the options against the referenced schema, and rejects others', async () => {
    expectTypeOf(() =>
      TransactionsModel.find(
        {},
        {
          populate: {
            // @ts-expect-error "nickname" is not a path of the account
            createdBy: { filter: { nickname: 'x' }, sort: { firstName: 1 } }
          }
        }
      )
    ).toBeFunction()
    await expect(
      TransactionsModel.findOne(
        { _id: 't1' },
        // @ts-expect-error limit is not an option of populate
        { populate: { approvers: { limit: 1 }, createdBy: { projection: 1 } } }
      )
    ).rejects.toMatchObject({
      issues: [
        {
          message: '"limit" is not an option of populate: use projection, filter, sort or populate',
          path: ['populate', 'approvers', 'limit']
        },
        {
          message: 'the projection of populate is an object',
          path: ['populate', 'createdBy', 'projection']
        }
      ]
    })
  })

  test('populates the references of the referenced documents, through their models', async () => {
    await AccountsModel.updateOne({ _id: 'a1' }, { $set: { lastTransaction: 't2' } })

    const transaction = await TransactionsModel.findOne(
      { _id: 't1' },
      {
        populate: {
          createdBy: {
            populate: { lastTransaction: { populate: { organization: true } } },
            projection: { email: 1, lastTransaction: 1 }
          }
        }
      }
    )

    expect(transaction?.createdBy).toEqual({
      _id: 'a1',
      email: 'ana@example.com',
      lastTransaction: {
        _id: 't2',
        amount: 20,
        approvers: [],
        createdBy: 'gone',
        organization: { _id: 'o1', name: 'Wortise', slug: 'wortise' },
        reviewer: null
      }
    })
    type Last = NonNullable<
      NonNullable<NonNullable<typeof transaction>['createdBy']>['lastTransaction']
    >

    expectTypeOf<Last['organization']>().toEqualTypeOf<WithId<
      z.output<typeof organizationSchema>
    > | null>()
    expectTypeOf<Last['amount']>().toEqualTypeOf<number>()
    expectTypeOf<Last['reviewer']>().toEqualTypeOf<string | null | undefined>()
    expectTypeOf<keyof Last>().toEqualTypeOf<
      '_id' | 'amount' | 'approvers' | 'createdBy' | 'organization' | 'reviewer'
    >()
  })

  test("checks a nested populate against the target's references", async () => {
    await expect(
      TransactionsModel.findOne(
        { _id: 't1' },
        // @ts-expect-error organization is a collection without a model
        { populate: { organization: { populate: { owner: true } } } }
      )
    ).rejects.toMatchObject({
      issues: [
        {
          message: '"organization" points to a collection without a model, which has no references',
          path: ['populate', 'organization', 'populate']
        }
      ]
    })
    await expect(
      TransactionsModel.findOne(
        { _id: 't1' },
        // @ts-expect-error email is not a reference of the accounts
        { populate: { createdBy: { populate: { email: true } } } }
      )
    ).rejects.toMatchObject({
      issues: [{ message: '"email" is not a reference of the model', path: ['populate', 'email'] }]
    })
  })

  test('asks for the _id of each document and removes it when the projection leaves it out', async () => {
    const transaction = await TransactionsModel.findOne(
      { _id: 't1' },
      { populate: { createdBy: { projection: { _id: 0, email: 1 } } } }
    )

    expect(transaction?.createdBy).toEqual({ email: 'ana@example.com' })
    expectTypeOf<NonNullable<typeof transaction>['createdBy']>().toEqualTypeOf<{
      email: string
    } | null>()
  })

  test('works in the findOneAnd… operations', async () => {
    const transaction = await TransactionsModel.findOneAndUpdate(
      { _id: 't1' },
      { $inc: { amount: 5 } },
      { populate: { createdBy: { projection: { email: 1 } } }, returnDocument: 'after' }
    )
    const result = await TransactionsModel.findOneAndDelete(
      { _id: 't1' },
      { includeResultMetadata: true, populate: { organization: { projection: { slug: 1 } } } }
    )

    expect(transaction).toMatchObject({ amount: 15, createdBy: { email: 'ana@example.com' } })
    expect(result.value?.organization).toEqual({ _id: 'o1', slug: 'wortise' })
    expectTypeOf<NonNullable<(typeof result)['value']>['organization']>().toEqualTypeOf<{
      _id: string
      slug: string
    } | null>()
  })

  test('works both ways between two models that reference each other', async () => {
    await AccountsModel.updateOne({ _id: 'a1' }, { $set: { lastTransaction: 't1' } })

    const account = await AccountsModel.findOne(
      { _id: 'a1' },
      { populate: { lastTransaction: { projection: { amount: 1 } } }, projection: { fullName: 1 } }
    )

    expect(account).toEqual({
      _id: 'a1',
      fullName: 'Ana Gómez',
      lastTransaction: { _id: 't1', amount: 10 }
    })
    expectTypeOf(account).toEqualTypeOf<{
      _id: string
      fullName: string
      lastTransaction?: { _id: string; amount: number } | null
    } | null>()
  })
})

describe('with a projection', () => {
  test('an inclusion still returns the references to populate', async () => {
    const transaction = await TransactionsModel.findOne(
      { _id: 't1' },
      { populate: { createdBy: { projection: { email: 1 } } }, projection: { amount: 1 } }
    )

    expect(transaction).toEqual({
      _id: 't1',
      amount: 10,
      createdBy: { _id: 'a1', email: 'ana@example.com' }
    })
    expectTypeOf(transaction).toEqualTypeOf<{
      _id: string
      amount: number
      createdBy: { _id: string; email: string } | null
    } | null>()
  })

  test('an exclusion cannot leave out a reference to populate', async () => {
    await expect(
      TransactionsModel.find(
        {},
        // @ts-expect-error the projection excludes createdBy
        { populate: { createdBy: true }, projection: { createdBy: 0 } }
      )
    ).rejects.toBeInstanceOf(z.ZodError)
    expectTypeOf(() =>
      TransactionsModel.find({}, { populate: { createdBy: true } })
        // @ts-expect-error the projection excludes createdBy
        .project({ createdBy: 0 })
    ).toBeFunction()
  })
})

describe('batches', () => {
  test('run one $in query per reference and per batch', async () => {
    const queries: CommandStartedEvent[] = []
    const listener = (event: CommandStartedEvent) => {
      if (event.commandName === 'find' && event.command.find === 'accounts') queries.push(event)
    }

    client.on('commandStarted', listener)

    try {
      const transactions = await TransactionsModel.find(
        {},
        { batchSize: 1, populate: { createdBy: { projection: { email: 1 } } } }
      )

      expect(transactions).toHaveLength(2)
      expect(queries.map((query) => query.command.filter)).toEqual([
        { _id: { $in: ['a1'] } },
        { _id: { $in: ['gone'] } }
      ])
    } finally {
      client.off('commandStarted', listener)
    }
  })

  test('close the cursor when the loop ends early', async () => {
    const commands: string[] = []
    const listener = (event: CommandStartedEvent) => commands.push(event.commandName)

    client.on('commandStarted', listener)

    try {
      for await (const transaction of TransactionsModel.find(
        {},
        { batchSize: 1, populate: { createdBy: true } }
      )) {
        expect(transaction._id).toBe('t1')

        break
      }

      expect(commands).toContain('killCursors')
    } finally {
      client.off('commandStarted', listener)
    }
  })

  test('share the session of the read, so they see the writes of its transaction', async () => {
    const session = client.startSession()

    try {
      await session.withTransaction(async () => {
        await AccountsModel.insertOne(
          { _id: 'a3', email: 'eva@example.com', firstName: 'Eva', lastName: 'Ruiz' },
          { session }
        )
        await TransactionsModel.insertOne(
          { _id: 't3', amount: 30, createdBy: 'a3', organization: 'o1' },
          { session }
        )

        const transaction = await TransactionsModel.findOne(
          { _id: 't3' },
          { populate: { createdBy: { projection: { fullName: 1 } } }, session }
        )

        expect(transaction?.createdBy).toEqual({ _id: 'a3', fullName: 'Eva Ruiz' })
      })
    } finally {
      await session.endSession()
    }
  })
})

describe('a populate that arrives at runtime', () => {
  test('may still have each reference as its id', async () => {
    const input: { createdBy?: { projection: { email?: 1 } } | true } = {
      createdBy: { projection: { email: 1 } }
    }
    const transaction = await TransactionsModel.findOne({ _id: 't1' }, { populate: input })

    expect(transaction?.createdBy).toEqual({ _id: 'a1', email: 'ana@example.com' })
    expectTypeOf<NonNullable<typeof transaction>['createdBy']>().toEqualTypeOf<
      | string
      | Account
      | {
          _id: string
          email?: string
          firstName?: string
          fullName?: string
          lastName?: string
          lastTransaction?: string
        }
      | null
    >()
  })

  test('throws a ZodError for a key that is not a reference', async () => {
    await expect(
      // @ts-expect-error amount is not a reference
      TransactionsModel.findOne({ _id: 't1' }, { populate: { amount: true } })
    ).rejects.toMatchObject({
      issues: [
        { message: '"amount" is not a reference of the model', path: ['populate', 'amount'] }
      ]
    })
  })
})

describe('the option', () => {
  test('needs a field of the schema', () => {
    expect(() =>
      mongozod({
        collection: 'transactions',
        db,
        // @ts-expect-error owner is not a field
        references: { owner: () => AccountsModel },
        schema: transactionSchema
      })
    ).toThrow('references needs the field "owner" in the schema')
  })

  test('takes paths through objects and arrays, without array indexes', () => {
    expect(() =>
      mongozod({
        collection: 'orders',
        db,
        // @ts-expect-error items.0.product names an index
        references: { 'items.0.product': () => AccountsModel },
        schema: z.object({
          _id: z.string(),
          items: z.array(z.object({ product: z.string(), qty: z.number() }))
        })
      })
    ).toThrow('references: "items.0.product" names an array index: a reference takes every element')
  })

  test('points to a function that returns a model, or to a collection and its schema', () => {
    const options = {
      collection: 'transactions',
      db,
      references: { createdBy: 'accounts' },
      schema: transactionSchema
    }

    expect(() => mongozod(options)).toThrow('references: "createdBy" points to neither a function')
    expectTypeOf(() =>
      // @ts-expect-error createdBy points to a string
      mongozod(options).find({}, { populate: { createdBy: true } })
    ).toBeFunction()
  })

  test('a field in one type of document is enough', async () => {
    const eventSchema = z.discriminatedUnion('kind', [
      z.object({ _id: z.string(), kind: z.literal('click'), by: z.string() }),
      z.object({ _id: z.string(), kind: z.literal('view') })
    ])
    const EventsModel = mongozod({
      collection: 'events',
      db,
      references: { by: () => AccountsModel },
      schema: eventSchema
    })

    await EventsModel.insertMany([
      { _id: 'e1', by: 'a1', kind: 'click' },
      { _id: 'e2', kind: 'view' }
    ])

    const events = await EventsModel.find(
      {},
      { populate: { by: { projection: { email: 1 } } } }
    ).sort({ _id: 1 })

    expect(events).toEqual([
      { _id: 'e1', by: { _id: 'a1', email: 'ana@example.com' }, kind: 'click' },
      { _id: 'e2', kind: 'view' }
    ])
  })

  test('populates only a field that stores the _id of its target', () => {
    const OrdersModel = mongozod({
      collection: 'orders',
      db,
      references: { buyer: () => AccountsModel },
      schema: z.object({ _id: z.string(), buyer: z.number() })
    })

    // @ts-expect-error buyer stores a number, and the _id of an account is a string
    expectTypeOf(() => OrdersModel.find({}, { populate: { buyer: true } })).toBeFunction()
  })

  test('is only on the models that have references', () => {
    // @ts-expect-error accounts have no reference called email
    expectTypeOf(() => AccountsModel.find({}, { populate: { email: true } })).toBeFunction()
  })
})

describe('a reference inside objects and arrays', () => {
  const productSchema = z.object({ _id: z.string(), name: z.string(), price: z.number() })
  const ProductsModel = mongozod({ collection: 'products', db, schema: productSchema })
  const OrdersModel = mongozod({
    collection: 'orders',
    db,
    references: {
      'items.alternatives': () => ProductsModel,
      'items.product': () => ProductsModel,
      'shipping.carrier': () => AccountsModel
    },
    schema: z.object({
      _id: z.string(),
      items: z.array(
        z.object({
          alternatives: z.array(z.string()).default([]),
          product: z.string(),
          qty: z.number()
        })
      ),
      shipping: z.object({ carrier: z.string(), city: z.string() }).optional()
    })
  })

  beforeEach(async () => {
    await ProductsModel.insertMany([
      { _id: 'p1', name: 'Mate', price: 10 },
      { _id: 'p2', name: 'Bombilla', price: 5 }
    ])
    await OrdersModel.insertMany([
      {
        _id: 'o1',
        items: [
          { alternatives: ['p2', 'gone'], product: 'p1', qty: 2 },
          { product: 'gone', qty: 1 }
        ],
        shipping: { carrier: 'a1', city: 'Rosario' }
      },
      { _id: 'o2', items: [{ product: 'p2', qty: 1 }] }
    ])
  })

  test('replaces the ids in each element and object, in one query per reference', async () => {
    const queries: string[] = []
    const listener = (event: CommandStartedEvent) => {
      if (event.commandName === 'find') queries.push(event.command.find)
    }

    client.on('commandStarted', listener)

    const [o1, o2] = await OrdersModel.find(
      {},
      {
        populate: {
          'items.alternatives': { projection: { name: 1 } },
          'items.product': { projection: { name: 1 } },
          'shipping.carrier': { projection: { email: 1 } }
        }
      }
    ).sort({ _id: 1 })

    client.off('commandStarted', listener)

    expect(o1).toEqual({
      _id: 'o1',
      items: [
        {
          alternatives: [{ _id: 'p2', name: 'Bombilla' }],
          product: { _id: 'p1', name: 'Mate' },
          qty: 2
        },
        { alternatives: [], product: null, qty: 1 }
      ],
      shipping: { carrier: { _id: 'a1', email: 'ana@example.com' }, city: 'Rosario' }
    })
    expect(o2?.items[0]?.product).toEqual({ _id: 'p2', name: 'Bombilla' })
    expect(o2).not.toHaveProperty('shipping')
    expect(queries.toSorted()).toEqual(['accounts', 'orders', 'products', 'products'])
    expectTypeOf<NonNullable<typeof o1>['items'][number]>().toEqualTypeOf<{
      alternatives: Array<{ _id: string; name: string }>
      product: { _id: string; name: string } | null
      qty: number
    }>()
    expectTypeOf<NonNullable<typeof o1>['shipping']>().toEqualTypeOf<
      { carrier: { _id: string; email: string } | null; city: string } | undefined
    >()
  })

  test('works with a projection that includes the object above the reference, or a sibling', async () => {
    const whole = await OrdersModel.findOne(
      { _id: 'o1' },
      { populate: { 'items.product': true }, projection: { items: 1 } }
    )
    const sibling = await OrdersModel.findOne(
      { _id: 'o1' },
      { populate: { 'items.product': true }, projection: { 'items.qty': 1 } }
    )

    expect(whole?.items[0]?.product).toEqual({ _id: 'p1', name: 'Mate', price: 10 })
    expect(sibling).toEqual({
      _id: 'o1',
      items: [
        { product: { _id: 'p1', name: 'Mate', price: 10 }, qty: 2 },
        { product: null, qty: 1 }
      ]
    })
  })

  test('needs the reference: a projection that excludes the object above it fails', async () => {
    await expect(
      OrdersModel.findOne(
        { _id: 'o1' },
        // @ts-expect-error the projection excludes items
        { populate: { 'items.product': true }, projection: { items: 0 } }
      )
    ).rejects.toMatchObject({
      issues: [{ message: 'populate needs "items.product": the projection excludes it' }]
    })
  })
})
