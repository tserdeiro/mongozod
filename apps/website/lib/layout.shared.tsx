import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

import { appName, githubUrl } from './shared'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <span className="font-semibold tracking-tight">{appName}</span>
    },
    githubUrl,
    links: [
      { text: 'Docs', url: '/docs', active: 'nested-url' },
      { text: 'From Mongoose', url: '/docs/mongoose' }
    ]
  }
}
