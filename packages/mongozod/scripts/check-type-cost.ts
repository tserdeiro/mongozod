// Compiles the typical project of test/type-cost with TypeScript 7 and 5.5, the minimum, and fails
// when its type instantiations go over the budget. They are what the editor pays on each check, and
// unlike the check time, the same code and versions always give the same count.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { z } from 'zod'

const budget = z
  .record(z.enum(['typescript', 'typescript-5.5']), z.number().int())
  .parse(JSON.parse(readFileSync('test/type-cost/budget.json', 'utf8')))
let failed = false

for (const [compiler, limit] of Object.entries(budget)) {
  const output = execFileSync(
    'node',
    [`node_modules/${compiler}/bin/tsc`, '-p', 'test/type-cost', '--extendedDiagnostics'],
    { encoding: 'utf8' }
  )
  const instantiations = Number(/Instantiations:\s+(\d+)/.exec(output)?.[1])
  const checkTime = /Check time:\s+(\S+)/.exec(output)?.[1]

  if (Number.isNaN(instantiations)) throw new Error(`${compiler} printed no instantiations`)

  const share = Math.round((instantiations / limit) * 100)

  process.stdout.write(
    `${compiler}: ${instantiations} instantiations, ${share}% of ${limit}, checked in ${checkTime}\n`
  )

  if (instantiations > limit) failed = true
}

if (failed) {
  console.error(
    'The types cost more than the budget: make them cheaper, or raise test/type-cost/budget.json in the same commit and say why.'
  )
  process.exitCode = 1
}
