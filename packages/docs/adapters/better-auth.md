---
title: Better Auth
description: A Better Auth database adapter for MongoDB whose reads and writes go through MongoZod models, so plugins such as soft delete apply to the users and organizations Better Auth manages.
---

`mongozodAdapter` is a [Better Auth](https://www.better-auth.com) database adapter that sends the
reads and writes of some tables through MongoZod models, so their plugins, such as
[`softDelete`](../plugins/soft-delete.md), apply to what Better Auth does. The other tables go
through the collections of the driver, as in the official MongoDB adapter, which it replaces. It is
in `mongozod/adapters/better-auth`, and it needs Better Auth 1.7 or later.

```ts
import { betterAuth } from 'better-auth'
import { mongozod } from 'mongozod'
import { mongozodAdapter, toAdditionalFields } from 'mongozod/adapters/better-auth'
import * as mz from 'mongozod/mzod'
import { softDelete } from 'mongozod/plugins/soft-delete'
import * as z from 'zod'

const userSchema = z.object({

  _id: z.uuidv4(),

  name: z.string(),

  email: z.string(),

  emailVerified: z.boolean(),

  image: z.string()
    .nullish(),

  createdAt: mz.date(),

  updatedAt: mz.date(),

  role: z.enum(['admin', 'member'])
    .default('member'),

  deletedAt: mz.date()
    .optional()
})

export const UsersModel = mongozod({

  collection: 'user',

  db,

  schema: userSchema,

  indexes: (index) => [
    index({ email: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } })
  ],

  plugins: [softDelete()]
})

export const auth = betterAuth({

  database: mongozodAdapter({ client, db, models: { user: UsersModel } }),

  advanced: { database: { generateId: () => crypto.randomUUID() } },

  emailAndPassword: { enabled: true },

  user: {

    additionalFields: toAdditionalFields(UsersModel, { role: { input: false } }),

    deleteUser: { enabled: true }
  }
})
```

Deleting a user marks it with `deletedAt`, Better Auth's reads skip it, and its email can sign up
again. Outside Better Auth, `UsersModel` reads and writes the same collection, with its types, for
the queries and pipelines of the app.

## Options

- **`db`**: the database of the tables.
- **`client`**: the `MongoClient` of `db`, which turns transactions on, as in the official adapter.
  MongoDB only has transactions in a replica set or a sharded cluster: on a standalone server, leave
  it out, or the first sign up fails with `IllegalOperation`.
- **`models`**: the models, by the name of their Better Auth table, such as `user`, `account` or
  `organization`. Their reads and writes go through the model and its plugins. The other tables,
  such as `session`, `verification` or the ones of OAuth, go through the collections of `db`.

## The schema of a model

The schema of a model declares `_id` and every field Better Auth writes in its table: its own, the
ones of its plugins, such as `organization` or `admin`, and the `additionalFields`. When one is
missing, Better Auth's first operation throws an `Error` that names the table and the fields.

Better Auth only sees the fields it knows: its reads return the fields of its schema, and a sign up
takes from its body the ones of `additionalFields`. A field of the model it does not know, such as
`deletedAt`, is optional or has a `.default()`, or every sign up fails.

A `json` field, such as an object of `additionalFields` or the `metadata` of an OAuth client, is
stored as a value, as MongoDB stores any object, so the model of its table takes it with a schema
such as a `z.object()`.

> [!NOTE]
> The official adapter and MongoZod 0.6 store a `json` field as text. The adapter still reads that
> text as its value, as Better Auth does, and a write of the field stores the value. Code
> that reads such a field outside Better Auth, through a model or the driver, sees the text until
> then.

Better Auth writes `createdAt` and `updatedAt` itself, so the model of one of its tables leaves
[`timestamps`](../guides/timestamps.md) off.

## Additional fields

A field Better Auth reads or takes from a sign up, such as a `role` the session needs, goes in its
`additionalFields`. `toAdditionalFields` builds them from the schema of the model, so the field is
declared once:

```ts
toAdditionalFields(UsersModel, {

  role: true
})
```

The mask names each field, as Zod's `.pick()`, with `true` or the options the schema does not say:
`input: false`, so a sign up cannot set it, and `returned: false`, so Better Auth does not return
it. The rest comes from the schema of the field:

| The field                                  | In Better Auth                                     |
| ------------------------------------------ | -------------------------------------------------- |
| `z.string()`, `z.number()`, `z.boolean()`  | `string`, `number`, `boolean`                      |
| `mz.date()` or `z.date()`                  | `date`                                             |
| `z.enum([...])`                            | its values, which Better Auth infers as a union    |
| `z.string().array()`, `z.number().array()` | `string[]`, `number[]`                             |
| anything else                              | `json`, which Better Auth types as a record        |
| `.optional()` or `.nullable()`             | `required: false`                                  |
| `.default(...)`                            | the `defaultValue`, computed again for each record |
| the schema of the field                    | `validator.input`, so Better Auth checks its input |

> [!WARNING]
> Leave the fields of Better Auth and of its plugins out of the mask: `additionalFields` replaces
> their definition. An `email` would lose its `unique`, and the `role` of the `admin` plugin its
> `input: false`, which keeps anyone from signing up as an admin.

## Indexes

The tables without a model get the indexes Better Auth declares, as in the official adapter: a
unique index for each `unique` field, such as `session.token`, and an index for each `index` one,
with the same names. The adapter starts them when it is created, and logs the ones it cannot build.

The tables with a model get the indexes of the model, which [`sync()`](../guides/sync.md) or
[`autoIndex`](../plugins/auto-index.md) create. With `softDelete`, a unique index takes
`partialFilterExpression: { deletedAt: null }`, as the `email` above: a full unique index would
keep a deleted email from signing up again.

## Transactions

With `client`, Better Auth runs each request in a transaction, such as a sign up, which creates the
user, its account and its session. A database hook that runs its own operations passes them the
session of that transaction, which `transactionSession()` returns: without it, an operation commits
on its own, and a later failure of the request does not roll it back.

This hook restores the deleted user of an email that signs up again, so its `_id`, and what other
collections keep under it, comes back:

```ts
import { transactionSession } from 'mongozod/adapters/better-auth'

export const restoringAuth = betterAuth({

  database: mongozodAdapter({ client, db, models: { user: UsersModel } }),

  advanced: { database: { generateId: () => crypto.randomUUID() } },

  emailAndPassword: { enabled: true },

  databaseHooks: {

    user: {

      create: {

        async before(user) {
          const session = transactionSession()

          if (!session) return undefined

          const deleted = await UsersModel.findOne(
            { email: user.email, deletedAt: { $exists: true } },
            { session }
          )

          if (!deleted) return undefined

          // Frees its `_id`, for the new user to take it. A filter that mentions `deletedAt`
          // deletes for real.
          await UsersModel.deleteOne({ _id: deleted._id, deletedAt: { $exists: true } }, { session })

          return { data: { ...user, id: deleted._id } }
        }
      }
    }
  }
})
```

A hook of one transaction cannot open another: it would commit apart, and the transaction of the
request would still see the deleted user. An `after` hook runs after the commit, outside the
transaction.

## Joins

With `advanced.database.joins`, the adapter reads each joined table through its model or its
collection, one query per table, so a model's plugins apply to the joined documents too: the user
of a session is `null` once it is deleted.

## Common mistakes

- **A field of Better Auth in `toAdditionalFields`**: it replaces the definition of Better Auth or
  of its plugin, and its `unique` or its `input: false` with it.
- **A required field Better Auth does not know**: Better Auth does not write it, so every sign up
  fails. Make it optional or give it a `.default()`.
- **A hook without `transactionSession()`**: its writes commit apart from the request. A hard
  delete followed by a failure of the sign up loses the deleted document.
- **A plugin that asks for context**: Better Auth's calls carry no `context`, so the writes of a
  model with such a plugin fail.
