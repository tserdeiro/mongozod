import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'vitest'

test('imports neither the driver nor its types, so that web and native clients take it', () => {
  const seen = new Set<string>()
  const packages = new Set<string>()

  function visit(file: string) {
    if (seen.has(file)) return

    seen.add(file)

    // Value and type imports alike, which the declarations keep, but not the examples of the JSDoc.
    const source = readFileSync(file, 'utf8')

    for (const [, specifier = ''] of source.matchAll(
      /^(?:import|export|\})[^\n]*from '([^']+)'/gm
    )) {
      if (specifier.startsWith('.')) visit(resolve(dirname(file), `${specifier}.ts`))
      else packages.add(specifier)
    }
  }

  visit(fileURLToPath(new URL('mzod.ts', import.meta.url)))

  expect([...packages].toSorted()).toEqual(['bson', 'zod', 'zod/v4/core'])
})
