import type { MetadataRoute } from 'next'

import { siteUrl } from '@/lib/shared'

// Open to every crawler, AI ones included: the docs are meant to be read and used by agents.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${siteUrl}/sitemap.xml`
  }
}
