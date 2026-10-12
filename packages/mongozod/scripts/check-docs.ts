// Compiles the TypeScript examples of the docs and of the README against the published declarations,
// as a project that installs mongozod would. The blocks of a page form one module, in order, so an
// example uses what an earlier one declared; a block opened with ```ts separate compiles alone, and
// one opened with ```ts nocheck does not compile. The errors point at the line of the page.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const docs = dirname(fileURLToPath(import.meta.resolve('@repo/docs/package.json')))
const pages = [
  'README.md',
  ...readdirSync(docs, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.md') && !path.startsWith('node_modules'))
    .map((path) => join(docs, path))
]
// For each written module, the page and the line of the page of each of its lines.
const sources = new Map<string, Array<{ page: string; line: number }>>()
// A folder for each run, so two runs at once do not compile or remove each other's files.
const examples = mkdtempSync('test/docs/examples-')

try {
  for (const page of pages) {
    const modules: Array<Array<{ code: string; line: number }>> = [[]]

    for (const block of tsBlocks(page)) {
      if (block.options.includes('nocheck')) continue

      const lines = block.code.map((code, index) => ({ code, line: block.line + index }))

      if (block.options.includes('separate')) modules.push(lines)
      else modules[0]?.push(...lines)
    }

    for (const [index, lines] of modules.entries()) {
      if (lines.length === 0) continue

      const file = join(examples, `${relative('..', page).replaceAll(/[/.]/g, '-')}-${index}.ts`)

      sources.set(
        file,
        lines.map(({ line }) => ({ page: relative('.', page), line }))
      )
      writeFileSync(file, `${lines.map(({ code }) => code).join('\n')}\n`)
    }
  }

  writeFileSync(
    join(examples, 'tsconfig.json'),
    JSON.stringify({ extends: '../tsconfig.json', include: ['../globals.d.ts', '.'] })
  )

  const tsc = spawnSync(
    'node',
    ['node_modules/typescript/bin/tsc', '-p', examples, '--pretty', 'false'],
    { encoding: 'utf8' }
  )

  // `file(line,col): error …` becomes `page:line:col: error …`.
  process.stdout.write(
    tsc.stdout.replaceAll(
      /^(\S+)\((\d+),(\d+)\)/gm,
      (match, file: string, line: string, column: string) => {
        const at = sources.get(file)?.[Number(line) - 1]

        return at === undefined ? match : `${at.page}:${at.line}:${column}`
      }
    )
  )

  if (tsc.status !== 0) {
    console.error(
      'An example of the docs does not compile: fix it, or open its block with ```ts nocheck.'
    )
    process.exitCode = 1
  }
} finally {
  rmSync(examples, { recursive: true, force: true })
}

// The ```ts blocks of a page: their options, their lines without the indent of a list, and the line
// of the page where their code starts.
function tsBlocks(page: string): Array<{ options: string[]; code: string[]; line: number }> {
  const blocks: Array<{ options: string[]; code: string[]; line: number }> = []
  let open: { indent: string; fence: string; block?: (typeof blocks)[number] } | undefined

  for (const [index, text] of readFileSync(page, 'utf8').split('\n').entries()) {
    const fence = /^(\s*)(`{3,}|~{3,})\s*([\w-]*)(.*)$/.exec(text)

    if (open === undefined && fence) {
      const [, indent = '', marker = '', language = '', options = ''] = fence

      open = { indent, fence: marker }

      if (language === 'ts' || language === 'typescript') {
        open.block = { options: options.trim().split(/\s+/), code: [], line: index + 2 }
        blocks.push(open.block)
      }
    } else if (
      open !== undefined &&
      fence?.[2]?.startsWith(open.fence) &&
      fence[3] === '' &&
      fence[4]?.trim() === ''
    ) {
      open = undefined
    } else {
      open?.block?.code.push(text.startsWith(open.indent) ? text.slice(open.indent.length) : text)
    }
  }

  return blocks
}
