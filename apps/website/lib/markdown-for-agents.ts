import { siteUrl } from './shared'

/**
 * A page as agents read it: its title, its description and its Markdown as written, with the
 * relative links between pages turned into the absolute URLs of their Markdown, so an agent that
 * fetched one page can follow them.
 */
export function markdownForAgents(
  page: { path: string; data: { title: string; description?: string } },
  raw: string
): string {
  const base = `${siteUrl}/docs/${page.path}`
  let fence: string | undefined
  const body = raw
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .trim()
    .split('\n')
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]

      if (marker !== undefined && (fence === undefined || marker.startsWith(fence))) {
        fence = fence === undefined ? marker : undefined
        return line
      }

      return fence === undefined
        ? line.replaceAll(
            /\]\((\.{1,2}\/[^)\s]*?\.md(?:#[^)\s]*)?)\)/g,
            (_link, target: string) => {
              return `](${new URL(target, base).href})`
            }
          )
        : line
    })
    .join('\n')

  return [`# ${page.data.title}`, page.data.description && `> ${page.data.description}`, body]
    .filter(Boolean)
    .join('\n\n')
}
