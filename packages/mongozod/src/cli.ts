#!/usr/bin/env node
// The `mongozod` command: `npx mongozod agents-md [--output <file>]`.
import { parseArgs } from 'node:util'

import { writeAgentRules } from './agents/agent-rules'

const USAGE = `Usage: npx mongozod agents-md [--output <file>]

Writes the MongoZod rules for coding agents to AGENTS.md, or to the file of --output, such as
CLAUDE.md, between their markers. Run it again after updating MongoZod.`

const VERBS = { added: 'Added', created: 'Created', updated: 'Updated' }

let args

try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      help: { short: 'h', type: 'boolean' },
      output: { default: 'AGENTS.md', short: 'o', type: 'string' }
    }
  })
} catch (error) {
  // An unknown option or one without its value prints the usage instead of a stack trace.
  if (
    !(
      error instanceof TypeError &&
      'code' in error &&
      String(error.code).startsWith('ERR_PARSE_ARGS_')
    )
  ) {
    throw error
  }

  process.stderr.write(`${error.message}\n\n`)
}

if (args?.values.help) {
  process.stdout.write(`${USAGE}\n`)
} else if (args?.positionals[0] === 'agents-md') {
  const result = writeAgentRules(args.values.output)

  process.stdout.write(`${VERBS[result]} the MongoZod rules in ${args.values.output}\n`)
} else {
  process.stderr.write(`${USAGE}\n`)
  process.exitCode = 1
}
