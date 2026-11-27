import type { Metadata } from 'next'
import type { Graph } from 'schema-dts'

import { JsonLd } from '@/components/json-ld'
import { LayerStack } from '@/components/layer-stack/layer-stack'
import { betterAuthPath } from '@/components/layer-stack/logos'
import {
  appName,
  githubUrl,
  siteDescription,
  siteUrl,
  softwareId,
  trademarkNotice,
  websiteId
} from '@/lib/shared'
import { ServerCodeBlock } from 'fumadocs-ui/components/codeblock.rsc'
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  openGraph: { siteName: appName, type: 'website', url: '/' }
}

// The site and the library, which the docs pages point to by their @id.
const structuredData: Graph = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': websiteId,
      'url': siteUrl,
      'name': appName,
      'description': siteDescription
    },
    {
      '@type': 'SoftwareSourceCode',
      '@id': softwareId,
      'name': appName,
      'description': siteDescription,
      'url': siteUrl,
      'codeRepository': githubUrl,
      'programmingLanguage': 'TypeScript',
      'runtimePlatform': 'Node.js',
      'license': 'https://www.apache.org/licenses/LICENSE-2.0',
      'author': { '@type': 'Person', 'name': 'tserdeiro', 'url': 'https://x.com/tserdeiro' },
      'sameAs': [githubUrl, 'https://www.npmjs.com/package/mongozod']
    }
  ]
}

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
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-4 py-10 md:py-16">
      <JsonLd data={structuredData} />
      <section className="grid grid-cols-[minmax(0,1fr)] items-center gap-8 md:grid-cols-[1.1fr_1fr] md:gap-12">
        <div className="flex flex-col items-center gap-6 text-center md:items-start md:text-left">
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">
            MongoDB with Zod as the single source of truth
          </h1>
          <p className="text-fd-muted-foreground max-w-2xl text-lg">
            The Mongoose alternative built on Zod and the official MongoDB® driver. One schema
            validates every write, types every read and defines what each endpoint accepts.
          </p>
          <div className="grid w-full grid-cols-2 gap-3 md:flex md:w-auto md:flex-wrap">
            <Link
              href="/docs/getting-started/quick-start"
              className="bg-fd-primary text-fd-primary-foreground flex items-center justify-center rounded-lg px-3 py-2.5 text-sm font-medium md:px-5 md:text-base"
            >
              Get started
            </Link>
            <Link
              href="/docs/mongoose"
              className="flex items-center justify-center rounded-lg border px-3 py-2.5 text-sm font-medium md:px-5 md:text-base"
            >
              Migrating from Mongoose
            </Link>
          </div>
          <div className="w-full max-w-md text-left">
            <ServerCodeBlock code="npm install mongozod" lang="sh" />
          </div>
        </div>
        <LayerStack />
      </section>

      <section className="text-left">
        <ServerCodeBlock
          code={example}
          codeblock={{ viewportProps: { className: 'max-h-none' } }}
          lang="ts"
        />
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

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">Integrations</h2>
        <Link
          href="/docs/adapters/better-auth"
          className="group bg-fd-card hover:bg-fd-accent flex flex-col gap-5 rounded-xl border p-5 transition-colors md:flex-row md:items-center md:gap-6 md:p-6"
        >
          <div className="bg-fd-background flex size-16 shrink-0 items-center justify-center rounded-xl border">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-8 fill-current">
              <path d={betterAuthPath} />
            </svg>
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="text-lg font-semibold">Better Auth</h3>
              <code className="text-fd-muted-foreground bg-fd-muted rounded-md px-2 py-0.5 text-xs">
                mongozod/adapters/better-auth
              </code>
            </div>
            <p className="text-fd-muted-foreground text-sm">
              A database adapter that sends the tables you choose through MongoZod models, so their
              schemas and plugins, such as soft delete, apply to the users and organizations Better
              Auth manages.
            </p>
          </div>
          <ArrowRight
            aria-hidden="true"
            className="text-fd-muted-foreground group-hover:text-fd-foreground hidden size-5 shrink-0 transition-transform group-hover:translate-x-1 md:block"
          />
        </Link>
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
          <a href={`${githubUrl}/security/policy`} className="underline">
            Security
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
