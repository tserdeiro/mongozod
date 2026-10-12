import { githubUrl, trademarkNotice } from '@/lib/shared'
import { ServerCodeBlock } from 'fumadocs-ui/components/codeblock.rsc'
import Link from 'next/link'

const example = `import { ObjectId } from 'mongodb'
import { mongozod } from 'mongozod'
import * as mz from 'mongozod/mzod'
import * as z from 'zod'

const postSchema = z.object({

  _id: mz.objectId()
    .default(() => new ObjectId()),

  title: z.string()
    .min(1),

  status: z.enum(['draft', 'published'])
    .default('draft'),

  tags: z.string()
    .array()
    .default([])
})

const PostsModel = mongozod({

  collection: 'posts',

  db,

  schema: postSchema
})

// Validated with the schema: _id, status and tags come from their defaults
const { document: post } = await PostsModel.insertOne({ title: 'Hello, MongoDB' })

// Typed by the schema: a status that is not in the enum does not compile
await PostsModel.updateOne({ _id: post._id }, { $set: { status: 'published' } })

// A projection narrows the result: Array<{ _id: ObjectId; title: string }>
const titles = await PostsModel.find({ tags: 'mongodb' }, { projection: { title: 1 } })

// An endpoint takes MongoDB syntax, limited to what it declares
const listPostsInput = z.object({

  filter: mz
    .filter(postSchema, {
      status: ['$eq'],
      tags: ['$in']
    })
    .default({})
})`

const features = [
  {
    title: 'Every write validated',
    body: 'Inserts, replacements and each value of every update operator, refinements included. An upsert validates the document it would insert.',
    href: '/docs/guides/validation'
  },
  {
    title: 'Strict types',
    body: 'Filters, updates, projections and sorts with every MongoDB operator and dotted paths, checked against the schema.',
    href: '/docs/guides/typescript'
  },
  {
    title: 'What you used in Mongoose',
    body: 'Populate, virtuals, timestamps, discriminators, indexes, $jsonSchema validation and plugins, such as soft delete.',
    href: '/docs/mongoose/cheatsheet'
  },
  {
    title: 'Endpoint inputs',
    body: 'Zod schemas that accept MongoDB syntax from clients, limited to what each endpoint declares, and BSON field types.',
    href: '/docs/guides/endpoint-inputs'
  },
  {
    title: 'The official driver',
    body: 'Its names, options and results, and the driver itself for everything else. Mongoose can share the connection while you migrate.',
    href: '/docs/guides/operations'
  },
  {
    title: 'Made for agents',
    body: 'The docs ship in the package at the installed version, and every page is Markdown at its .md URL, with llms.txt.',
    href: '/docs/getting-started/ai-agents'
  }
]

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-4 py-16">
      <section className="flex flex-col items-center gap-6 text-center">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">
          MongoDB with Zod as the single source of truth
        </h1>
        <p className="text-fd-muted-foreground max-w-2xl text-lg">
          The Mongoose alternative built on Zod and the official MongoDB® driver. One schema
          validates every write, types every read and defines what each endpoint accepts.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/docs/getting-started/quick-start"
            className="bg-fd-primary text-fd-primary-foreground rounded-lg px-5 py-2.5 font-medium"
          >
            Get started
          </Link>
          <Link href="/docs/mongoose" className="rounded-lg border px-5 py-2.5 font-medium">
            Migrating from Mongoose
          </Link>
        </div>
        <div className="w-full max-w-md text-left">
          <ServerCodeBlock code="npm install mongozod" lang="sh" />
        </div>
      </section>

      <section className="text-left">
        <ServerCodeBlock code={example} lang="ts" />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {features.map((feature) => (
          <Link
            key={feature.title}
            href={feature.href}
            className="bg-fd-card hover:bg-fd-accent rounded-xl border p-5 transition-colors"
          >
            <h2 className="mb-2 font-semibold">{feature.title}</h2>
            <p className="text-fd-muted-foreground text-sm">{feature.body}</p>
          </Link>
        ))}
      </section>

      <footer className="text-fd-muted-foreground flex flex-col gap-2 border-t pt-6 text-xs">
        <p>
          by{' '}
          <a href="https://x.com/tserdeiro" className="underline">
            @tserdeiro
          </a>{' '}
          ·{' '}
          <a href={githubUrl} className="underline">
            GitHub
          </a>{' '}
          ·{' '}
          <a href="/llms.txt" className="underline">
            llms.txt
          </a>
        </p>
        <p>{trademarkNotice}</p>
      </footer>
    </main>
  )
}
