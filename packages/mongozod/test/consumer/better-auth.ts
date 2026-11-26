// Compiles the Better Auth adapter against the published declarations: Better Auth infers the
// fields of toAdditionalFields, and the adapter takes a model.
import { betterAuth } from 'better-auth'
import { MongoClient } from 'mongodb'
import { mongozod } from 'mongozod'
import {
  mongozodAdapter,
  toAdditionalFields,
  transactionSession
} from 'mongozod/adapters/better-auth'
import { softDelete } from 'mongozod/plugins/soft-delete'
import { z } from 'zod'

const client = new MongoClient('mongodb://localhost')
const db = client.db()

const UsersModel = mongozod({
  collection: 'user',
  db,
  plugins: [softDelete()],
  schema: z.object({
    _id: z.string(),
    createdAt: z.date(),
    deletedAt: z.date().optional(),
    email: z.string(),
    emailVerified: z.boolean(),
    image: z.string().nullish(),
    name: z.string(),
    plan: z.enum(['free', 'pro']).default('free'),
    role: z.enum(['admin', 'member']),
    updatedAt: z.date()
  })
})

export const auth = betterAuth({
  database: mongozodAdapter({ client, db, models: { user: UsersModel } }),
  databaseHooks: {
    user: {
      create: {
        async before(user) {
          const session = transactionSession()

          await UsersModel.countDocuments({ email: user.email }, session ? { session } : {})

          return undefined
        }
      }
    }
  },
  emailAndPassword: { enabled: true },
  user: { additionalFields: toAdditionalFields(UsersModel, { plan: true, role: true }) }
})

type User = typeof auth.$Infer.Session.user

export const role: User['role'] = 'admin'
export const plan: User['plan'] = 'pro'
// @ts-expect-error: not a role
export const owner: User['role'] = 'owner'
