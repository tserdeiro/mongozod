import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript-5.5'
import { expect, test } from 'vitest'

test('imports neither the driver nor its types, so that web and native clients take it', () => {
  const seen = new Set<string>()
  const packages = new Set<string>()

  function visit(file: string) {
    if (seen.has(file)) return

    seen.add(file)

    // What TypeScript reads as imports, which the declarations keep: also an `import('…')` in a type,
    // a `require` and a reference to types, but not a string or a comment, such as an `@example`.
    const { importedFiles, typeReferenceDirectives } = ts.preProcessFile(
      readFileSync(file, 'utf8'),
      true,
      true
    )

    for (const { fileName } of [...importedFiles, ...typeReferenceDirectives]) {
      if (fileName.startsWith('.')) visit(resolve(dirname(file), `${fileName}.ts`))
      else packages.add(fileName)
    }
  }

  visit(fileURLToPath(new URL('mzod.ts', import.meta.url)))

  expect([...packages].toSorted()).toEqual(['bson', 'zod', 'zod/v4/core'])
})
