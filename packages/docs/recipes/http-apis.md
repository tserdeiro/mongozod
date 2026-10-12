---
title: HTTP APIs
description: Take a filter in a GET request, read an id from the route, turn errors into responses and log them readably.
---

These recipes use the web's standard `Request` and `Response`, which Node.js has as globals. With
another framework, read the request and write the response its own way: the rest is the same.

## A GET with the filter in `q`

A query string only carries strings, and `mz.filter` doesn't turn `'1'` into a number. Send the
filter as JSON in one parameter, `q`, and decode it with the JSON codec from
[Zod's docs](https://zod.dev/codecs#jsonschema):

```ts
import { MongoServerError, ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const postSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  title: z.string()
    .min(1),

  slug: z.string(),

  status: z.enum(['draft', 'published'])
    .default('draft'),

  tags: z.string()
    .array()
    .default([]),

  authorId: mz.objectId(),

  createdAt: mz.date(),

  updatedAt: mz.date()
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema,

  timestamps: true,

  indexes: (index) => [
    index({ slug: 1 }, { unique: true })
  ]
})

const jsonCodec = <T extends z.core.$ZodType>(schema: T) =>
  z.codec(z.string(), schema, {

    decode: (json, ctx) => {
      try {
        return JSON.parse(json)
      } catch {
        ctx.issues.push({ code: 'invalid_format', format: 'json', input: json })

        return z.NEVER
      }
    },

    encode: (value) => JSON.stringify(value)
  })

const listPostsQuery = z.object({

  q: jsonCodec(
    mz.filter(postSchema, {
      authorId: ['$eq'],
      tags: ['$in'],
      createdAt: ['$gte', '$lt']
    })
  )
    .default({}),

  limit: z.coerce.number()
    .int()
    .min(1)
    .max(100)
    .default(20)
})

// GET /posts?q={"tags":{"$in":["mongodb"]},"createdAt":{"$gte":"2026-01-01T00:00:00Z"}}&limit=10
export async function listPosts(request: Request) {

  const query = listPostsQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams))

  if (!query.success) return Response.json(z.flattenError(query.error), { status: 400 })

  const { q, limit } = query.data

  const posts = await PostsModel.find(
    { $and: [q, { status: 'published' }] },
    { sort: { createdAt: -1 }, limit }
  )

  return Response.json(posts)
}
```

JSON keeps numbers, booleans, `null` and nested operators, and `mz.filter` parses each value with
the schema of its field, so the hex of `authorId` arrives as an `ObjectId` and the ISO string as a
`Date`. The handler joins the client's filter with its own scope in an `$and`, so the client cannot
replace a key of the scope.

A client builds the URL with `URLSearchParams`, which encodes the JSON:

```ts
const params = new URLSearchParams({ q: JSON.stringify({ tags: { $in: ['mongodb'] } }) })

await fetch(`https://blog.example.com/posts?${params}`)
```

For a parameter that is a plain value, such as `limit`, `z.coerce` is enough. See
[Endpoint inputs](../guides/endpoint-inputs.md) for what `mz.filter` takes.

## An id from the route

A route like `/posts/:id` gives the id as a string. Parse it with `mz.objectId()`, which takes the
hex and returns an `ObjectId`:

```ts
export async function getPost(id: string) {

  const parsed = mz.objectId().safeParse(id)

  if (!parsed.success) return Response.json(z.flattenError(parsed.error), { status: 400 })

  const post = await PostsModel.findOne({ _id: parsed.data })

  if (!post) return Response.json({ error: 'not found' }, { status: 404 })

  return Response.json(post)
}
```

## Errors to clients

A `ZodError` comes from the input of the endpoint or from a write whose data doesn't fit the schema,
and the driver's errors arrive unchanged, such as a duplicate key on the unique index of `slug`. One
function turns them into responses:

```ts
function errorResponse(error: unknown) {

  if (error instanceof z.ZodError) return Response.json(z.flattenError(error), { status: 400 })

  if (error instanceof MongoServerError && error.code === 11000) {
    return Response.json({ error: 'already exists', keyValue: error.keyValue }, { status: 409 })
  }

  console.error(error)

  return Response.json({ error: 'internal error' }, { status: 500 })
}

const createPostBody = postSchema.pick({ title: true, slug: true, tags: true, authorId: true })

export async function createPost(request: Request) {

  try {
    const body = createPostBody.parse(await request.json())

    const { document } = await PostsModel.insertOne(body)

    return Response.json(document, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
```

`z.flattenError` gives the messages of each field, `{ formErrors, fieldErrors }`. The errors of an
update are under their operator, as in `{ fieldErrors: { $set: ['Too small: …'] } }`, because
their path is `['$set', 'title']`. For nested objects, `z.treeifyError` mirrors the schema
([Zod docs](https://zod.dev/error-formatting)).

`errorResponse` answers 400 to every `ZodError`, which fits when the client sent the data. A
`ZodError` from data your own code builds is a bug: catch it apart, log it and answer 500.

## Readable errors in logs

The `message` of a `ZodError` is the JSON of its issues: log `z.prettifyError(error)`, which gives
one line per issue with its path, as [Validation](../guides/validation.md#the-zoderror) shows.

A cursor of `find` can be awaited, but it has no `.catch()`. Await it inside `try`, or call
`.toArray()`, which returns a promise.

## Common mistakes

- **Filters in plain query parameters**: `?views=10` arrives as the string `'10'`, which a number
  field rejects. Send the filter as JSON in `q`.
- **Passing query or route parameters to the model without parsing them**: MongoZod doesn't cast
  filters, so a hex string never matches an `ObjectId`. Parse with `mz.filter` or `mz.objectId()`.
- **Answering 500 to a client's invalid data**: catch `ZodError` and answer 400, and 409 for a
  duplicate key (`code` 11000).
- **Logging `error.message` of a `ZodError`**: it's a JSON string. Log `z.prettifyError(error)`.
