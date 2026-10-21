#!/usr/bin/env node
// The `mongozod` command: `npx mongozod agents-md [--output <file>]`.
import { parseArgs } from 'node:util'

import { writeAgentRules } from './agents/agent-rules'

const USAGE = `Usage: npx mongozod agents-md [--output <file>]

Writes the mongozod rules for coding agents to AGENTS.md, or to the file of --output, such as
CLAUDE.md, between their markers. Run it again after updating mongozod.`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { output: { default: 'AGENTS.md', short: 'o', type: 'string' } }
})

if (positionals[0] === 'agents-md') {
  const result = writeAgentRules(values.output)

  process.stdout.write(
    `${result === 'updated' ? 'Updated' : 'Added'} the mongozod rules in ${values.output}\n`
  )
} else {
  process.stderr.write(`${USAGE}\n`)
  process.exitCode = 1
}
