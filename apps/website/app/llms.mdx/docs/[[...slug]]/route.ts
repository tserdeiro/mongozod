import { getPageMarkdownUrl, siteUrl } from '@/lib/shared'
import { docsLlms, source } from '@/lib/source'
import { notFound } from 'next/navigation'

export const revalidate = false

export async function GET(
  _request: Request,
  { params }: RouteContext<'/llms.mdx/docs/[[...slug]]'>
) {
  const { slug = [] } = await params
  // Drops the appended "content.md"; `/docs/index.md` and `/docs/mongoose/index.md` name the
  // index page of their folder.
  const slugs = slug.slice(0, -1)

  if (slugs.at(-1) === 'index') slugs.pop()

  const page = source.getPage(slugs)

  if (!page) notFound()

  return new Response(await docsLlms.page(page), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      // Search engines index the HTML page, and agents keep reading this Markdown.
      'Link': `<${siteUrl}${page.url}>; rel="canonical"`
    }
  })
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    slug: getPageMarkdownUrl(page).segments
  }))
}
