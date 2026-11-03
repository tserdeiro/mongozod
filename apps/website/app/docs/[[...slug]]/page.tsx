import type { Metadata } from 'next'
import type { Graph } from 'schema-dts'

import { JsonLd } from '@/components/json-ld'
import { getMDXComponents } from '@/components/mdx'
import {
  appName,
  docsRoute,
  getPageGithubUrl,
  getPageImageUrl,
  getPageMarkdownUrl,
  siteUrl,
  softwareId,
  trademarkNotice,
  websiteId
} from '@/lib/shared'
import { source } from '@/lib/source'
import { getBreadcrumbItems } from 'fumadocs-core/breadcrumb'
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
  // The sidebar's path to the page, from the docs, without the folders that have no page of their
  // own. The tree's root has no name, so the docs come first by hand.
  const breadcrumb = [
    { name: 'Docs', url: docsRoute },
    ...getBreadcrumbItems(page.url, source.getPageTree(), { includePage: true }).flatMap(
      ({ name, url }) =>
        typeof name === 'string' && url && url !== docsRoute ? [{ name, url }] : []
    )
  ]
  const structuredData: Graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TechArticle',
        'headline': page.data.title,
        'description': page.data.description,
        'url': `${siteUrl}${page.url}`,
        'isPartOf': { '@id': websiteId },
        'about': { '@id': softwareId }
      },
      {
        '@type': 'BreadcrumbList',
        'itemListElement': breadcrumb.map(({ name, url }, index) => ({
          '@type': 'ListItem',
          'position': index + 1,
          name,
          'item': `${siteUrl}${url}`
        }))
      }
    ]
  }

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <JsonLd data={structuredData} />
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
    alternates: {
      canonical: page.url,
      // Tells agents where the Markdown of the page is, as the llms.txt convention suggests.
      types: { 'text/markdown': `${page.url}.md` }
    },
    openGraph: {
      siteName: appName,
      type: 'article',
      url: page.url,
      images: getPageImageUrl(page).url
    }
  }
}
