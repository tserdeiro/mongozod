// Writes README.md, the index of the docs: the title and description of each page, in the order of
// the meta.json files. GitHub shows it when the folder is opened, and agents find it in
// node_modules/mongozod/dist/docs/. With --check, it fails when README.md is out of date instead.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { parse } from 'yaml'
import { z } from 'zod'

const metaSchema = z.object({
  title: z.string().optional(),
  pages: z.array(z.string())
})
const frontmatterSchema = z.object({
  title: z.string(),
  description: z.string()
})
const lines = [
  '# mongozod documentation',
  '',
  '<!-- Written by `pnpm --filter @repo/docs index` from the meta.json files and the frontmatter of each page. -->',
  '',
  'The documentation of [mongozod](https://github.com/tserdeiro/mongozod), one Markdown file per',
  'page. Read it here, at [mongozod.dev/docs](https://mongozod.dev/docs), or in',
  '`node_modules/mongozod/dist/docs/` when mongozod is installed, where it matches the installed',
  'version.'
]

for (const page of metaSchema.parse(readJson('meta.json')).pages) {
  const folder = metaSchema.safeParse(readJson(join(page, 'meta.json')))

  if (!folder.success) {
    lines.push('', item(`${page}.md`))
    continue
  }

  lines.push('', `## ${folder.data.title ?? page}`, '')

  // The index page of a folder is the folder's own link, so its meta.json doesn't list it.
  if (existsSync(join(page, 'index.md'))) lines.push(item(join(page, 'index.md')))

  for (const child of folder.data.pages) lines.push(item(join(page, `${child}.md`)))
}

const index = `${lines.join('\n')}\n`

if (process.argv.includes('--check')) {
  if (readFileSync('README.md', 'utf8') !== index) {
    console.error('README.md is out of date: run `pnpm --filter @repo/docs index`.')
    process.exitCode = 1
  }
} else {
  writeFileSync('README.md', index)
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    // A page is a file, not a folder with a meta.json: the caller tells them apart.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

function item(path: string): string {
  const source = readFileSync(path, 'utf8')
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(source)?.[1]

  if (frontmatter === undefined) throw new Error(`${path} has no frontmatter`)

  const { title, description } = frontmatterSchema.parse(parse(frontmatter))

  return `- [${title}](./${path}): ${description}`
}
