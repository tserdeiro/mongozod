import type * as PageTree from 'fumadocs-core/page-tree'

import { siteUrl, trademarkNotice } from '@/lib/shared'
import { source } from '@/lib/source'

export const revalidate = false

// The llms.txt convention (llmstxt.org): the name, a summary, then a section of links per folder of
// the docs, each to the Markdown of its page.
export function GET() {
  const lines = [
    '# mongozod',
    '',
    '> MongoDB with a Zod schema as the single source of truth for each document: it validates every write, types every read and defines what each endpoint accepts. The Mongoose alternative built on Zod and the official MongoDB driver.',
    '',
    'Install it with `npm install mongozod zod mongodb bson`. Each page below is Markdown, and the same pages ship in the package, in `node_modules/mongozod/dist/docs/`, at the installed version. All of them in one file: ' +
      `${siteUrl}/llms-full.txt.`,
    '',
    trademarkNotice
  ]

  for (const node of source.getPageTree().children) {
    if (node.type === 'page') lines.push('', item(node))

    if (node.type === 'folder') {
      lines.push('', `## ${typeof node.name === 'string' ? node.name : ''}`, '')

      if (node.index) lines.push(item(node.index))

      for (const child of node.children) if (child.type === 'page') lines.push(item(child))
    }
  }

  return new Response(`${lines.join('\n')}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}

function item(node: PageTree.Item): string {
  const page = source.getPages().find(({ url }) => url === node.url)

  return `- [${page?.data.title ?? node.url}](${siteUrl}${node.url}.md): ${page?.data.description ?? ''}`
}
