import { defineConfig } from 'fumadocs-mdx/config'

import { remarkGithubAlerts } from './lib/remark-github-alerts'

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkGithubAlerts]
  }
})
