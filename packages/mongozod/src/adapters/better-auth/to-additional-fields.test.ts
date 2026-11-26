import type { InferDBValueType } from 'better-auth'

import { betterAuth } from 'better-auth'
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

import { mongozod } from '../../mongozod'

import { mongozodAdapter } from './mongozod-adapter'
import { toAdditionalFields } from './to-additional-fields'

const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-better-auth-fields')

beforeAll(() => client.connect())
afterAll(() => client.close())
beforeEach(() => db.dropDatabase())

const UsersModel = mongozod({
  collection: 'user',
  db,
  schema: z.object({
    _id: z.string(),
    createdAt: z.date(),
    email: z.string(),
    emailVerified: z.boolean(),
    image: z.string().nullish(),
    joinedAt: z.date().default(() => new Date()),
    name: z.string(),
    nickname: z.string().min(2).optional(),
    plan: z.enum(['free', 'pro']).default('free'),
    profile: z.object({ bio: z.string() }).optional(),
    role: z.enum(['admin', 'member']),
    score: z.number().int(),
    tags: z.array(z.string()),
    updatedAt: z.date()
  })
})

const additionalFields = toAdditionalFields(UsersModel, {
  joinedAt: { input: false },
  nickname: true,
  plan: true,
  profile: true,
  role: true,
  score: true,
  tags: true
})

const auth = betterAuth({
  advanced: { database: { generateId: () => crypto.randomUUID() } },
  database: mongozodAdapter({ db, models: { user: UsersModel } }),
  emailAndPassword: { enabled: true },
  logger: { disabled: true },
  user: { additionalFields }
})

const body = {
  email: 'ana@example.com',
  name: 'Ana',
  password: 'password1234',
  role: 'admin' as const,
  score: 3,
  tags: ['a']
}

/** Never called: its calls only compile, or not. */
function maskTypes() {
  // @ts-expect-error: not a field
  toAdditionalFields(UsersModel, { nope: true })
  // @ts-expect-error: input only takes false, the default being true
  toAdditionalFields(UsersModel, { role: { input: true } })
}

describe('types', () => {
  test('the user Better Auth infers', () => {
    type User = typeof auth.$Infer.Session.user

    expectTypeOf<User['role']>().toEqualTypeOf<'admin' | 'member'>()
    expectTypeOf<User['plan']>().toEqualTypeOf<'free' | 'pro'>()
    expectTypeOf<User['score']>().toEqualTypeOf<number>()
    expectTypeOf<User['tags']>().toEqualTypeOf<string[]>()
    expectTypeOf<User['joinedAt']>().toEqualTypeOf<Date>()
    expectTypeOf<User['nickname']>().toEqualTypeOf<string | null | undefined>()
    // Better Auth types a json field as a record.
    expectTypeOf<User['profile']>().toEqualTypeOf<InferDBValueType<'json'> | null | undefined>()
  })

  test('the input of a sign up', () => {
    const { email, name, password } = body
    const typeOnly = () => {
      // Without plan, which has a default, nor joinedAt, which has input: false.
      void auth.api.signUpEmail({
        body: { email, name, password, role: 'member', score: 1, tags: [] }
      })
      // @ts-expect-error: role is required
      void auth.api.signUpEmail({ body: { email, name, password, score: 1, tags: [] } })
      // @ts-expect-error: not a role
      void auth.api.signUpEmail({ body: { ...body, role: 'owner' } })
      // @ts-expect-error: not a plan
      void auth.api.signUpEmail({ body: { ...body, plan: 'gold' } })
      // @ts-expect-error: joinedAt has input: false
      void auth.api.signUpEmail({ body: { ...body, joinedAt: new Date() } })
    }

    expect(typeOnly).toBeTypeOf('function')
  })

  test('the mask takes the fields of the schema', () => {
    expect(maskTypes).toBeTypeOf('function')
  })
})

describe('runtime', () => {
  test('the attributes', () => {
    expect(additionalFields).toMatchObject({
      joinedAt: { input: false, required: true, type: 'date' },
      nickname: { required: false, type: 'string' },
      plan: { defaultValue: 'free', required: true, type: ['free', 'pro'] },
      profile: { required: false, type: 'json' },
      role: { required: true, type: ['admin', 'member'] },
      score: { required: true, type: 'number' },
      tags: { required: true, type: 'string[]' }
    })
    expect(additionalFields.role.validator.input).toBe(UsersModel.schema.shape.role)
  })

  test('a sign up takes the defaults, each its own', async () => {
    const { user } = await auth.api.signUpEmail({ body })
    const second = await auth.api.signUpEmail({ body: { ...body, email: 'bea@example.com' } })

    expect(user.plan).toBe('free')
    expect(user.joinedAt).toBeInstanceOf(Date)
    expect(second.user.joinedAt).not.toBe(user.joinedAt)
    expect(await db.collection('user').findOne({ email: body.email })).toMatchObject({
      plan: 'free',
      role: 'admin'
    })
  })

  test('Better Auth validates the input with the schema of the field', async () => {
    await expect(auth.api.signUpEmail({ body: { ...body, nickname: 'x' } })).rejects.toThrow(
      '>=2 characters'
    )
  })

  test('a field the schema does not have, and a schema that is not an object', () => {
    // @ts-expect-error: not a field
    expect(() => toAdditionalFields(UsersModel, { nope: true })).toThrow(
      'toAdditionalFields: the schema has no field "nope"'
    )
    // @ts-expect-error: the schema is not an object
    expect(() => toAdditionalFields({ schema: z.string() }, {})).toThrow(
      'toAdditionalFields takes a model whose schema is a z.object'
    )
  })
})
