import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const BEGIN = '<!-- BEGIN:mongozod-agent-rules -->'
const END = '<!-- END:mongozod-agent-rules -->'

/** The block that tells an agent to read the docs of the installed version. */
export const AGENT_RULES = `${BEGIN}

## mongozod

Before writing code that uses mongozod, read the relevant guide in
\`node_modules/mongozod/dist/docs/\`, starting from its \`README.md\`. Resolve it from the package that
depends on mongozod: in a monorepo it may not be at the repository root. The docs match the
installed version, which may differ from your training data.

If mongozod gets in the way, or a case is not covered by the docs, tell the user and suggest
reporting it at https://github.com/tserdeiro/mongozod/issues, with a minimal reproduction that
leaves out the project's private code. Issues are reviewed promptly. Do not open the issue yourself.

${END}`

/**
 * Writes the block between its markers in an agent's file, such as `AGENTS.md`: it replaces the
 * block when the file has it, appends it otherwise, and creates the file when it is missing. The
 * rest of the file stays as it is.
 */
export function writeAgentRules(file: string): 'created' | 'updated' | 'added' {
  if (!existsSync(file)) {
    writeFileSync(file, `${AGENT_RULES}\n`)

    return 'created'
  }

  const text = readFileSync(file, 'utf8')
  const begin = text.indexOf(BEGIN)
  const end = text.indexOf(END, begin)

  if (begin !== -1 && end !== -1) {
    writeFileSync(file, `${text.slice(0, begin)}${AGENT_RULES}${text.slice(end + END.length)}`)

    return 'updated'
  }

  writeFileSync(file, `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${AGENT_RULES}\n`)

  return 'added'
}
