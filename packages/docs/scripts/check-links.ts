// Fails when a relative link of a page points to a file or a heading that does not exist. The anchors
// are the slugs GitHub gives the headings, which the site uses too.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

import GithubSlugger from 'github-slugger'

const pages = readdirSync('.', { recursive: true, encoding: 'utf8' }).filter(
  (path) => path.endsWith('.md') && !path.startsWith('node_modules')
)
const anchors = new Map(pages.map((page) => [normalize(page), headingSlugs(page)]))
let broken = 0

for (const page of pages) {
  for (const { line, target } of links(page)) {
    const [path = '', anchor] = target.split('#')
    const file = path === '' ? normalize(page) : normalize(join(dirname(page), path))
    const missing = !existsSync(file)
      ? 'the file does not exist'
      : anchor !== undefined && !anchors.get(file)?.has(anchor) && 'the heading does not exist'

    if (missing) {
      console.error(`${page}:${line}: ${target}: ${missing}`)
      broken++
    }
  }
}

if (broken > 0) process.exitCode = 1

function headingSlugs(page: string): Set<string> {
  const slugger = new GithubSlugger()

  return new Set(
    proseLines(page)
      .map(({ text }) => /^#{1,6}\s+(.*)$/.exec(text)?.[1])
      .filter((heading) => heading !== undefined)
      // GitHub slugs the text it shows: without the code marks, the emphasis and the link targets.
      .map((heading) =>
        slugger.slug(heading.replaceAll(/\[([^\]]*)\]\([^)]*\)/g, '$1').replaceAll(/`|\*\*/g, ''))
      )
  )
}

function links(page: string): Array<{ line: number; target: string }> {
  return proseLines(page).flatMap(({ line, text }) =>
    [...text.matchAll(/\]\(([^)\s]+)\)/g)]
      .map((match) => match[1] ?? '')
      .filter((target) => !/^[a-z]+:/i.test(target))
      .map((target) => ({ line, target }))
  )
}

// The lines of a page outside its code blocks, numbered from 1.
function proseLines(page: string): Array<{ line: number; text: string }> {
  let fence: string | undefined

  return readFileSync(page, 'utf8')
    .split('\n')
    .flatMap((text, index) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(text)?.[1]

      if (marker !== undefined && (fence === undefined || marker.startsWith(fence))) {
        fence = fence === undefined ? marker : undefined
        return []
      }

      return fence === undefined ? [{ line: index + 1, text }] : []
    })
}
