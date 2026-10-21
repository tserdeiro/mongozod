import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vitest'

import { AGENT_RULES, writeAgentRules } from './agent-rules'

function file(content?: string) {
  const path = join(mkdtempSync(join(tmpdir(), 'mongozod-agents-')), 'AGENTS.md')

  if (content !== undefined) writeFileSync(path, content)

  return path
}

test('creates the file with the block', () => {
  const path = file()

  expect(writeAgentRules(path)).toBe('created')
  expect(readFileSync(path, 'utf8')).toBe(`${AGENT_RULES}\n`)
})

test('appends the block, and keeps what the file has', () => {
  const path = file('# Agent instructions\n\nUse pnpm.\n')

  expect(writeAgentRules(path)).toBe('added')
  expect(readFileSync(path, 'utf8')).toBe(`# Agent instructions\n\nUse pnpm.\n\n${AGENT_RULES}\n`)
})

test('replaces an older block between its markers, and nothing else', () => {
  const path = file(
    '# Rules\n\n<!-- BEGIN:mongozod-agent-rules -->\nold\n<!-- END:mongozod-agent-rules -->\n\n## Mine\n'
  )

  expect(writeAgentRules(path)).toBe('updated')
  expect(readFileSync(path, 'utf8')).toBe(`# Rules\n\n${AGENT_RULES}\n\n## Mine\n`)
  expect(writeAgentRules(path)).toBe('updated')
  expect(readFileSync(path, 'utf8')).toBe(`# Rules\n\n${AGENT_RULES}\n\n## Mine\n`)
})

test('is the block the AI agents page shows', () => {
  const page = readFileSync(
    new URL('../../../docs/getting-started/ai-agents.md', import.meta.url),
    'utf8'
  )

  expect(page).toContain(AGENT_RULES)
})
