import { createGetUrl } from 'fumadocs-core/source'

export const appName = 'mongozod'
export const siteUrl = 'https://mongozod.dev'
export const docsRoute = '/docs'
export const docsImageRoute = '/og/docs'
export const docsContentRoute = '/llms.mdx/docs'
export const githubUrl = 'https://github.com/tserdeiro/mongozod'

/** The notice that mongozod is not a MongoDB product, on every page of the site. */
export const trademarkNotice =
  'mongozod is an independent open-source project. It is not affiliated with, endorsed by or sponsored by MongoDB, Inc. MongoDB® is a registered trademark of MongoDB, Inc.'

const getContentUrl = createGetUrl(docsContentRoute)
const getImageUrl = createGetUrl(docsImageRoute)

/** The URL of the Markdown of a page, which `/docs/<page>.md` rewrites to. */
export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md']

  return { segments, url: getContentUrl(segments, page.locale) }
}

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png']

  return { segments, url: getImageUrl(segments, page.locale) }
}

/** The page's file on GitHub, in packages/docs. */
export function getPageGithubUrl(page: { path: string }) {
  return `${githubUrl}/blob/main/packages/docs/${page.path}`
}
