---
title: Connection
description: What to set on the MongoClient, on the database user and on the server for an app that uses MongoZod.
---

MongoZod uses the driver's connection as it is: a `MongoClient`, and the `Db` each model takes
(see [`db`](../guides/models.md#db)). This page lists what to set on each side, from the
[MongoDB security checklist](https://www.mongodb.com/docs/manual/administration/security-checklist/)
and the
[Node.js security best practices](https://nodejs.org/en/learn/getting-started/security-best-practices),
with what matters to MongoZod.

## The client

```ts
import { MongoClient } from 'mongodb'

const client = new MongoClient(process.env.MONGODB_URI ?? 'mongodb://localhost:27017', {
  appName: 'blog'
})

const db = client.db('blog')
```

- **The connection string comes from the environment**, with the credentials of the
  [application's user](#the-user) and TLS: `mongodb+srv://` turns it on, and a `mongodb://` string
  takes `tls=true`.
- **`useBigInt64: true`** when a schema has a `z.bigint()`: without it, the driver reads a long as a
  number, so every operation of that model throws (see [Schemas](../guides/schemas.md)).
- **`maxTimeMS`** goes per operation, in the options a model method takes: it stops a query that
  runs too long, such as a `$regex` a client sent (see [Cost](../guides/security.md#cost)).
- **`ignoreUndefined` is not a protection.** With it, the driver drops a key whose value is
  `undefined` instead of sending `null`, so `findOne({ email: undefined })` becomes `findOne({})`
  and matches the first document. MongoZod drops `undefined` keys when it writes and in the
  builders of `mongozod/mzod`, and throws a `ZodError` for an `undefined` value in a filter (see
  [Values that skip the builders](../guides/security.md#values-that-skip-the-builders)).
- **Leave `promoteBuffers` off**: it reads every `Binary` as a `Buffer`, UUIDs included, where the
  field types of `mongozod/mzod` return a `Binary` and a `UUID`.

## The user

Connect with a user that has only what the application needs, as the checklist's principle of
least privilege says: `readWrite` on its database. It includes `createIndex`, so `sync()` creates
the indexes a model declares with it.

`sync()` with [`jsonSchema`](../guides/sync.md#jsonschema) applies the validator with
`collMod`, an action of `dbAdmin`, not of `readWrite`
([built-in roles](https://www.mongodb.com/docs/manual/reference/built-in-roles/)). Run `sync()` from
a deploy step with a user that has `dbAdmin` too, and keep the application's user at `readWrite`:

```js
// mongosh, as a user administrator
db.createUser({ user: 'blog', pwd: passwordPrompt(), roles: [{ role: 'readWrite', db: 'blog' }] })

db.createUser({
  user: 'blog-deploy',
  pwd: passwordPrompt(),
  roles: [
    { role: 'readWrite', db: 'blog' },
    { role: 'dbAdmin', db: 'blog' }
  ]
})
```

## The server

- **Server-side JavaScript**: MongoZod never runs it, and `mz.filter` rejects `$where`. But a
  filter of a model, an `aggregate` pipeline and an update with `updatePipeline: true` reach the
  server as you write them, `$where`, `$function` and `$accumulator` included. When the application
  doesn't use them, disable server-side scripting, as the checklist says: `security.javascriptEnabled:
  false` in the configuration file, or `--noscripting` on the command line.
- **Access control** on, with `bindIp` and a firewall that leave the server reachable from the
  application only.

```yaml
security:
  authorization: enabled
  javascriptEnabled: false
```

What follows is the deployment's, outside MongoZod: TLS on every connection, encryption at rest,
auditing, a dedicated system user and the
[CVEs of MongoDB](https://www.mongodb.com/alerts). The checklist covers each one. On Atlas, most of
it is set up for you.

## Next steps

- [Models](../guides/models.md), for a `db` per request, such as a tenant's.
- [Security](../guides/security.md), for what the builders guarantee and what stays with the
  application.
