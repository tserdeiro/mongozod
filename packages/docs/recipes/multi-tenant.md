---
title: Multi-tenant
description: Give each tenant its own database, with db as a function that returns the database of the current request.
---

When each tenant has its own database, `db` takes a function instead of a `Db`. The model calls it
on every operation, so one model serves every tenant: the function returns the database of the
request that is running, here from an
[`AsyncLocalStorage`](https://nodejs.org/api/async_context.html#class-asynclocalstorage).

```ts
import type { Db } from 'mongodb'

import { AsyncLocalStorage } from 'node:async_hooks'

import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import { z } from 'zod'

const tenantDb = new AsyncLocalStorage<Db>()

function currentDb() {
  const found = tenantDb.getStore()

  if (!found) throw new Error('no tenant: run the operation inside withTenant()')

  return found
}

const postSchema = z.object({
  _id: mz.objectId().default(() => new ObjectId()),
  title: z.string(),
  status: z.enum(['draft', 'published']).default('draft')
})

export const PostsModel = mongozod({ collection: 'posts', db: currentDb, schema: postSchema })
```

## Keep a `Db` per tenant

Each request runs inside `tenantDb.run()`, with the database of its tenant. Keep one `Db` per
tenant: `client.db(name)` builds a new one on each call, and the model keeps its collection per
`Db`, so returning the same one reuses it. Every `Db` shares the connections of the client.

```ts
const tenantDbs = new Map<string, Db>()

/** Runs a function, such as the handler of a request, with the database of a tenant. */
export function withTenant<T>(tenant: string, run: () => T): T {
  let found = tenantDbs.get(tenant)

  if (!found) {
    found = client.db(`blog_${tenant}`)
    tenantDbs.set(tenant, found)
  }

  return tenantDb.run(found, run)
}

// In the middleware that authenticates each request, with the tenant of its user.
await withTenant('acme', () => PostsModel.insertOne({ title: 'Hello, MongoDB' }))
```

Every operation runs on the tenant's database, `aggregate` and `populate` included.
`PostsModel.db` and `PostsModel.collection` give the database and the collection of the function's
`Db` at that moment, in your code and in the hooks of the plugins. A function that throws, like
`currentDb` outside of a request, rejects the operation.

## Cursors keep their tenant

A cursor of `find` or `aggregate` starts on its first read, but it runs in the async context where
it was created, like a promise. One created in a request and read later still reads its tenant's
database, also for `populate` and the hooks of the plugins:

```ts
const cursor = withTenant('acme', () => PostsModel.find({ status: 'published' }))

// Outside of the request: still the posts of acme.
const posts = await cursor
```

The other way around, a cursor created outside of a request, such as in a helper that builds it
before entering `withTenant()`, doesn't see the tenant, even when it is read inside one. With
`currentDb`, its first read throws.

## Sync each tenant

`sync()` creates the indexes and the `$jsonSchema` in the database the function returns, so run it
in each tenant, such as when one is created or on each deploy:

```ts
for (const tenant of ['acme', 'globex']) {
  await withTenant(tenant, () => PostsModel.sync())
}
```

## Why a database per tenant

A database per tenant isolates every operation, `aggregate` and `.collection` included. A shared
collection with a `tenantId` field relies on a [plugin](../guides/plugins.md) that fills and filters
it, but `aggregate` takes no `context` and skips the group hooks of the plugins, so each pipeline
has to filter the tenant in its own `$match`.

Mongoose resolves the same case with `useDb()`, cached with `useCache: true`, and a model per
tenant ([Mongoose docs](https://mongoosejs.com/docs/connections.html#multi-tenant-connections)). A
model per tenant also works with mongozod, but one model with a function is enough.

## Common mistakes

- **`db: () => client.db(name)`**: builds a new `Db` on each operation, so the model never reuses
  its collection. Keep a `Db` per tenant, as `withTenant()` does.
- **A cursor created before the request**: it reads the database of where it was created, not of
  where it is read. Create it inside `withTenant()`.
- **`sync()` once at startup**: only the database the function returns then gets the indexes. Run
  it in each tenant.
- **A fallback to a default database**: `tenantDb.getStore() ?? client.db()` sends an operation
  that runs outside of a request to the default database without an error. Throw instead, unless
  that database is meant to be shared.
