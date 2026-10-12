import { llms, loader } from 'fumadocs-core/source'
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons'
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema'
import { defineDocs } from 'fumadocs-mdx/macro'

import { markdownForAgents } from './markdown-for-agents'
import { docsRoute } from './shared'

// The pages of @repo/docs: the same Markdown files GitHub shows and the package ships in dist/docs/.
const docs = defineDocs({
  dir: '../../packages/docs',
  docs: {
    schema: pageSchema,
    // README.md is the index for GitHub and node_modules; the site builds its own from meta.json.
    files: ['**/*.md', '!README.md', '!node_modules/**'],
    postprocess: {
      includeProcessedMarkdown: true
    }
  },
  meta: {
    schema: metaSchema,
    files: ['**/meta.json', '!node_modules/**']
  }
})

export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()]
})

// What agents read: each page as written, the same Markdown as on GitHub and in node_modules.
export const docsLlms = llms(source, {
  renderPage: async (page) => markdownForAgents(page, await page.data.getText('raw'))
})
