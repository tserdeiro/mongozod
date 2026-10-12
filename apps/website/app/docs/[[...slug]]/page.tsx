import type { Metadata } from 'next'

import { getMDXComponents } from '@/components/mdx'
import {
  getPageGithubUrl,
  getPageImageUrl,
  getPageMarkdownUrl,
  trademarkNotice
} from '@/lib/shared'
import { source } from '@/lib/source'
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover
} from 'fumadocs-ui/layouts/docs/page'
import { createRelativeLink } from 'fumadocs-ui/mdx'
import { notFound } from 'next/navigation'

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params
  const page = source.getPage(params.slug)

  if (!page) notFound()

  const MDX = page.data.body
  const markdownUrl = getPageMarkdownUrl(page).url

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <div className="flex flex-row items-center gap-2 border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover markdownUrl={markdownUrl} githubUrl={getPageGithubUrl(page)} />
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // Links between pages are relative paths to their files, as on GitHub.
            a: createRelativeLink(source, page)
          })}
        />
      </DocsBody>
      <p className="text-fd-muted-foreground border-t pt-4 text-xs">{trademarkNotice}</p>
    </DocsPage>
  )
}

export function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params
  const page = source.getPage(params.slug)

  if (!page) notFound()

  return {
    title: page.data.title,
    description: page.data.description,
    // Tells agents where the Markdown of the page is, as the llms.txt convention suggests.
    alternates: { types: { 'text/markdown': `${page.url}.md` } },
    openGraph: {
      images: getPageImageUrl(page).url
    }
  }
}
