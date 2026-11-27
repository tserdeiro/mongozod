import type { BetterAuthOptions } from 'better-auth'

import { betterAuth } from 'better-auth'
import { MongoClient, ObjectId } from 'mongodb'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test, vi } from 'vitest'
import { z } from 'zod'

import { mongozod } from '../../mongozod'
import { objectId } from '../../mzod/fields/bson'
import { softDelete } from '../../plugins/soft-delete'

import { mongozodAdapter } from './mongozod-adapter'
import { transactionSession } from './transaction-session'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-better-auth')

beforeAll(async () => {
  await client.connect()
  await db.dropDatabase()
  // Builds Better Auth's indexes once, before any transaction: a transaction that writes to a
  // collection while an index is built on it aborts with a TransientTransactionError, which Better
  // Auth wraps, so MongoDB does not retry it. The adapters of the tests then find them built.
  await authWith().$context
  await vi.waitFor(
    async () => {
      // The name of a command is its first key.
      // oxlint-disable-next-line sort-keys
      const command = { 'currentOp': true, 'command.createIndexes': { $exists: true } }
      const { inprog } = await client.db('admin').command(command)
      const names = (await db.collection('session').indexes()).map((index) => index.name)

      if (inprog.length > 0 || !names.includes('session_token_uidx')) {
        throw new Error("Better Auth's indexes are still being built")
      }
    },
    { timeout: 10_000 }
  )
})
afterAll(() => client.close())
// Empties the collections and keeps their indexes.
beforeEach(async () => {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray()

  await Promise.all(collections.map(({ name }) => db.collection(name).deleteMany({})))
})

const userFields = {
  createdAt: z.date(),
  deletedAt: z.date().optional(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullish(),
  name: z.string(),
  updatedAt: z.date()
}

const UsersModel = mongozod({
  collection: 'user',
  db,
  plugins: [softDelete()],
  schema: z.object({ _id: z.string(), ...userFields })
})

const body = { email: 'ana@example.com', name: 'Ana', password: 'password1234' }

function authWith(options: Partial<BetterAuthOptions> = {}) {
  return betterAuth({
    advanced: { database: { generateId: () => crypto.randomUUID() } },
    database: mongozodAdapter({ client, db, models: { user: UsersModel } }),
    emailAndPassword: { enabled: true },
    logger: { disabled: true },
    user: { deleteUser: { enabled: true } },
    ...options
  })
}

/** Signs up and deletes the account, and returns the id of its user. */
async function signUpAndDelete(auth: ReturnType<typeof authWith>) {
  const { headers, response } = await auth.api.signUpEmail({ body, returnHeaders: true })
  // The last cookie of a name wins, as in a browser: when MongoDB retries the transaction, as on a
  // write conflict with an index build, Better Auth sets the session cookie again.
  const cookies = new Map(
    headers.getSetCookie().map((setCookie) => {
      const [pair = ''] = setCookie.split(';')
      const [name = '', ...value] = pair.split('=')

      return [name, value.join('=')]
    })
  )
  const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')

  await auth.api.deleteUser({ body: { password: body.password }, headers: new Headers({ cookie }) })

  return response.user.id
}

describe('the tables with a model', () => {
  test('a deleted user is marked, and signing in no longer finds it', async () => {
    const auth = authWith()
    const id = await signUpAndDelete(auth)
    const stored = await UsersModel.findOne({ _id: id, deletedAt: { $exists: true } })

    expect(stored?.deletedAt).toBeInstanceOf(Date)
    // The tables without a model delete for real.
    expect(await db.collection('account').countDocuments()).toBe(0)
    expect(await db.collection('session').countDocuments()).toBe(0)
    await expect(auth.api.signInEmail({ body })).rejects.toThrow('Invalid email or password')
  })

  test('signing up again with a deleted email creates another user', async () => {
    const auth = authWith()
    const id = await signUpAndDelete(auth)
    const { user } = await auth.api.signUpEmail({ body })

    expect(user.id).not.toBe(id)
    expect(await db.collection('user').countDocuments()).toBe(2)
  })

  test('the writes go through the model and its validation', async () => {
    const StrictUsers = mongozod({
      collection: 'user',
      db,
      schema: z.object({ _id: z.string(), ...userFields, name: z.string().min(5) })
    })
    const auth = authWith({
      database: mongozodAdapter({ client, db, models: { user: StrictUsers } })
    })

    await expect(auth.api.signUpEmail({ body })).rejects.toThrow('Failed to create user')
    expect(await db.collection('user').countDocuments()).toBe(0)
  })

  test('the adapter builds no Better Auth index for them', async () => {
    const auth = authWith()

    await auth.api.signUpEmail({ body })
    await vi.waitFor(async () => {
      const names = (await db.collection('session').indexes()).map((index) => index.name)

      expect(names).toContain('session_token_uidx')
    })

    const names = (await db.collection('user').indexes()).map((index) => index.name)

    expect(names).not.toContain('user_email_uidx')
  })

  test('the joins go through the model of the joined table', async () => {
    const auth = authWith({
      advanced: { database: { generateId: () => crypto.randomUUID(), joins: true } }
    })
    const { token, user } = await auth.api.signUpEmail({ body })
    const { adapter } = await auth.$context
    const where = [{ field: 'token', value: token ?? '' }]
    const joined = await adapter.findOne<{ user: { id: string } | null }>({
      join: { user: true },
      model: 'session',
      where
    })

    expect(joined?.user?.id).toBe(user.id)

    await UsersModel.deleteOne({ _id: user.id })

    const afterDelete = await adapter.findOne<{ user: unknown }>({
      join: { user: true },
      model: 'session',
      where
    })

    expect(afterDelete?.user).toBeNull()
  })

  test('ObjectId ids', async () => {
    const ObjectIdUsers = mongozod({
      collection: 'user',
      db,
      schema: z.object({ _id: objectId(), ...userFields })
    })
    const auth = betterAuth({
      database: mongozodAdapter({ client, db, models: { user: ObjectIdUsers } }),
      emailAndPassword: { enabled: true },
      logger: { disabled: true }
    })
    const { user } = await auth.api.signUpEmail({ body })
    const stored = await db.collection('user').findOne({})
    const session = await db.collection('session').findOne({})

    expect(stored?._id).toBeInstanceOf(ObjectId)
    expect(session?.userId).toBeInstanceOf(ObjectId)
    expect((await auth.api.signInEmail({ body })).user.id).toBe(user.id)
  })

  test('a json field is stored as a value, with a model and without one', async () => {
    const JsonUsers = mongozod({
      collection: 'user',
      db,
      schema: z.object({
        _id: z.string(),
        ...userFields,
        preferences: z.object({ theme: z.string() }).optional()
      })
    })
    const auth = betterAuth({
      account: { additionalFields: { scopes: { required: false, type: 'json' } } },
      advanced: { database: { generateId: () => crypto.randomUUID() } },
      database: mongozodAdapter({ client, db, models: { user: JsonUsers } }),
      emailAndPassword: { enabled: true },
      logger: { disabled: true },
      user: { additionalFields: { preferences: { required: false, type: 'json' } } }
    })
    const { user } = await auth.api.signUpEmail({
      body: { ...body, preferences: { theme: 'dark' } }
    })
    const { adapter } = await auth.$context

    expect(user).toMatchObject({ preferences: { theme: 'dark' } })
    expect(await JsonUsers.findOne({ _id: user.id })).toMatchObject({
      preferences: { theme: 'dark' }
    })

    await adapter.update({
      model: 'user',
      update: { preferences: { theme: 'light' } },
      where: [{ field: 'id', value: user.id }]
    })
    await adapter.update({
      model: 'account',
      update: { scopes: { read: true } },
      where: [{ field: 'userId', value: user.id }]
    })

    expect(await JsonUsers.findOne({ _id: user.id })).toMatchObject({
      preferences: { theme: 'light' }
    })
    expect(await db.collection('account').findOne({ userId: user.id })).toMatchObject({
      scopes: { read: true }
    })
    expect(
      await adapter.findOne({ model: 'account', where: [{ field: 'userId', value: user.id }] })
    ).toMatchObject({ scopes: { read: true } })
  })

  test('a json field stored as text, as the official adapter stores it, reads as its value', async () => {
    const auth = betterAuth({
      account: { additionalFields: { scopes: { required: false, type: 'json' } } },
      advanced: { database: { generateId: () => crypto.randomUUID() } },
      database: mongozodAdapter({ db, models: { user: UsersModel } }),
      emailAndPassword: { enabled: true },
      logger: { disabled: true }
    })
    const { user } = await auth.api.signUpEmail({ body })
    const { adapter } = await auth.$context
    const accounts = db.collection('account')
    const read = async () => {
      const account = await adapter.findOne<{ scopes: unknown }>({
        model: 'account',
        where: [{ field: 'userId', value: user.id }]
      })

      return account?.scopes
    }

    await accounts.updateOne(
      {},
      { $set: { scopes: '{"read":true,"grantedAt":"2026-01-01T00:00:00.000Z"}' } }
    )
    expect(await read()).toEqual({ grantedAt: new Date('2026-01-01T00:00:00.000Z'), read: true })

    await accounts.updateOne({}, { $set: { scopes: 'null' } })
    expect(await read()).toBeNull()

    // A string that is not JSON stays as it is.
    await accounts.updateOne({}, { $set: { scopes: 'read' } })
    expect(await read()).toBe('read')
  })
})

/**
 * The recipe of the docs: restores the deleted user of an email that signs up again, inside the
 * transaction of the sign up, and does nothing without one.
 */
function restoring(transactionClient: MongoClient | undefined, failAccount = false) {
  return authWith({
    database: mongozodAdapter({
      ...(transactionClient && { client: transactionClient }),
      db,
      models: { user: UsersModel }
    }),
    databaseHooks: {
      account: {
        create: {
          async before() {
            if (failAccount) throw new Error('account fails')
          }
        }
      },
      user: {
        create: {
          async before(user) {
            const session = transactionSession()

            if (!session) return undefined

            const deleted = await UsersModel.findOne(
              { deletedAt: { $exists: true }, email: user.email },
              { session }
            )

            if (!deleted) return undefined

            await UsersModel.deleteOne(
              { _id: deleted._id, deletedAt: { $exists: true } },
              { session }
            )

            return { data: { ...user, id: deleted._id } }
          }
        }
      }
    }
  })
}

describe('transactions', () => {
  test('a failure rolls back the writes of both kinds of tables', async () => {
    const auth = authWith({
      databaseHooks: {
        account: {
          create: {
            async before() {
              throw new Error('account fails')
            }
          }
        }
      }
    })

    await expect(auth.api.signUpEmail({ body })).rejects.toThrow('account fails')
    expect(await db.collection('user').countDocuments()).toBe(0)
    expect(await db.collection('account').countDocuments()).toBe(0)
  })

  test('transactionSession() joins a hook to the transaction of the request', async () => {
    const id = await signUpAndDelete(restoring(client))

    // A later failure rolls the hard delete back, so the deleted user is still there.
    await expect(restoring(client, true).api.signUpEmail({ body })).rejects.toThrow('account fails')
    expect(await UsersModel.countDocuments({ _id: id, deletedAt: { $exists: true } })).toBe(1)

    const { user } = await restoring(client).api.signUpEmail({ body })

    expect(user.id).toBe(id)
    expect(await UsersModel.countDocuments({ _id: id, deletedAt: { $exists: true } })).toBe(0)
    expect(transactionSession()).toBeUndefined()
  })

  test('without a client, the restoring hook leaves the deleted user alone', async () => {
    const id = await signUpAndDelete(restoring(undefined))
    const { user } = await restoring(undefined).api.signUpEmail({ body })

    expect(user.id).not.toBe(id)
    expect(await UsersModel.countDocuments({ _id: id, deletedAt: { $exists: true } })).toBe(1)
  })

  test('without a client, the operations run one after the other', async () => {
    const auth = authWith({
      database: mongozodAdapter({ db, models: { user: UsersModel } }),
      databaseHooks: {
        user: {
          create: {
            async before() {
              expect(transactionSession()).toBeUndefined()
            }
          }
        }
      }
    })

    expect((await auth.api.signUpEmail({ body })).user.email).toBe(body.email)
  })
})

describe('the models', () => {
  test('a schema without a field Better Auth writes throws an Error', async () => {
    const Partial = mongozod({
      collection: 'user',
      db,
      schema: z.object({ _id: z.string(), email: z.string(), name: z.string() })
    })
    const auth = authWith({ database: mongozodAdapter({ db, models: { user: Partial } }) })

    await expect(auth.$context).rejects.toThrow(
      'The schema of "user" lacks fields that Better Auth writes in its "user" table: emailVerified, image, createdAt, updatedAt'
    )
  })

  test('a model of a table Better Auth does not have throws an Error', async () => {
    const auth = authWith({
      database: mongozodAdapter({ db, models: { users: UsersModel } })
    })

    await expect(auth.$context).rejects.toThrow('Better Auth has no table "users"')
  })
})

describe('indexes and transactions', () => {
  test('a transaction never waits for an index build on a table it already reads', async () => {
    const fresh = client.db('mongozod-better-auth-index-locks')

    await fresh.dropDatabase()

    const auth = betterAuth({
      database: mongozodAdapter({ client, db: fresh }),
      logger: { disabled: true },
      plugins: [
        {
          id: 'resources',
          schema: {
            resource: {
              fields: {
                clientId: { required: true, type: 'string' },
                resourceId: { required: true, type: 'string' }
              },
              indexes: [{ fields: ['clientId', 'resourceId'], unique: true }]
            }
          }
        }
      ]
    })
    const { adapter } = await auth.$context
    const where = [{ field: 'clientId', value: 'client' }]

    // The collection exists, as when another index of the table was built first.
    await fresh.createCollection('resource')

    // As the OAuth provider registers a client: reading the table takes its lock in the
    // transaction, which an index build would wait for until the transaction ends.
    await adapter.transaction(async (trx) => {
      await trx.findOne({ model: 'resource', where })
      await trx.create({ data: { clientId: 'client', resourceId: 'mcp' }, model: 'resource' })
    })

    expect(await fresh.collection('resource').countDocuments()).toBe(1)
  }, 20_000)
})
