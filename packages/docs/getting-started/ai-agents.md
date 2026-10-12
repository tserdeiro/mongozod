---
title: AI agents
description: Point a coding agent at the docs installed with mongozod, and the mistakes agents trained on Mongoose tend to make.
---

A coding agent may know Mongoose well and mongozod not at all, or know an older version of it. The
docs ship inside the package, so an agent can read the ones that match the version you installed,
without a network request.

## The docs in `node_modules`

Every page of these docs is in `node_modules/mongozod/dist/docs/`, as Markdown, with the same
folders as the docs on GitHub:

```
node_modules/mongozod/dist/docs/
├── README.md          the index: the title and description of each page
├── index.md
├── getting-started/
├── guides/
├── plugins/
├── mongoose/
├── recipes/
└── api/
```

Updating mongozod updates them.

## Tell your agent

Most coding agents read `AGENTS.md` at the root of the project when a session starts. Add this
block to it, or to the file your agent reads instead, like `CLAUDE.md`:

```md
<!-- BEGIN:mongozod-agent-rules -->

## mongozod

Before writing code that uses mongozod, read the relevant guide in
`node_modules/mongozod/dist/docs/`, starting from its `README.md`. Resolve it from the package that
depends on mongozod: in a monorepo it may not be at the repository root. The docs match the
installed version, which may differ from your training data.

<!-- END:mongozod-agent-rules -->
```

The markers let you find and replace the block later. To point the agent at one topic, name the
page in your prompt: _"Read `node_modules/mongozod/dist/docs/guides/populate.md`, then populate the
author of each post in `listPosts`."_

## The docs on the web

[mongozod.dev](https://mongozod.dev) serves the same pages to agents that fetch them:

- **Markdown for every page**: add `.md` to its URL, as in
  `https://mongozod.dev/docs/guides/populate.md`, or request the page with an
  `Accept: text/markdown` header. The links between pages point to their `.md` URLs.
- **`/llms.txt`**: the index, following the [llms.txt](https://llmstxt.org/) convention, with the
  title, the description and the Markdown URL of each page.
- **`/llms-full.txt`**: every page in one file.

On GitHub, the pages are in
[`packages/docs`](https://github.com/tserdeiro/mongozod/tree/main/packages/docs).

## Migrating from Mongoose with an agent

[Migrating from Mongoose](../mongoose/index.md#copy-prompt) has a prompt you can copy into your
agent to migrate one model. The same workflow is an agent skill, which you install with the
[skills CLI](https://github.com/vercel-labs/skills):

```sh
npx skills add tserdeiro/mongozod --skill migrate-from-mongoose
```

## Common mistakes

Agents trained on Mongoose code tend to write it with mongozod. What to expect, and what to ask for
instead:

- **Mongoose's API**: `new Model(…).save()`, `Model.create()`, `findById()`, `.lean()` and
  `.exec()` don't exist. A model has the driver's operations: `insertOne`, `findOne({ _id })`,
  `updateOne`, and reads already return plain objects. See [Operations](../guides/operations.md).
- **A string where an `ObjectId` goes**: mongozod doesn't cast filters, so `{ _id: '65f…' }` on an
  `ObjectId` field doesn't compile. Parse what a client sends with
  [`mz.filter`](../guides/endpoint-inputs.md) or `mz.objectId()`, or build it with
  `new ObjectId(id)`.
- **`import { mz } from 'mongozod/mzod'`**: there is no `mz` export. Write
  `import * as mz from 'mongozod/mzod'`, as with Zod.
- **`z.set()` or `z.map()` in a document**: defining the model throws an `Error`, because the driver
  stores a `Set` as an empty object and a `Map` as a plain object, and neither comes back as such.
  Use [`mz.set()`](../guides/bson-types.md#sets) for an array without repeated values and
  `z.record()` for dynamic keys.
- **A `.transform()` on the whole document**: defining the model throws an `Error`, because updates
  write paths and could not run it. Compute a field from others with `.overwrite()`. See
  [Schemas](../guides/schemas.md).
- **Expecting reads to be parsed**: reads return what the driver returns, without running the
  schema. A transform runs when a document is written, not when it is read.
