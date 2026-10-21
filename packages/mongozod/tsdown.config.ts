import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'tsdown'

// The pages of the docs, which an agent reads in node_modules/mongozod/dist/docs/, at the installed
// version.
const docs = dirname(fileURLToPath(import.meta.resolve('@repo/docs/package.json')))

export default defineConfig({
  entry: [
    'src/cli.ts',
    'src/index.ts',
    'src/mzod.ts',
    'src/plugins/auto-index.ts',
    'src/plugins/soft-delete.ts'
  ],
  dts: true,
  // One file per module, so a bundler drops the modules an app does not use, such as the `bson`
  // fields of `mongozod/mzod` when a client only builds inputs.
  unbundle: true,
  // Writes the `exports` field of package.json from the entries, but the command's, which is a `bin`.
  exports: { exclude: ['cli'] },
  // Their errors fail the build. Not `failOnWarn`: the declarations are emitted with TypeScript 7,
  // whose API rolldown-plugin-dts still warns is experimental.
  publint: {
    strict: true
  },
  attw: {
    profile: 'esm-only',
    level: 'error'
  },
  // Without `flatten`, the pages keep their folders under the folder of @repo/docs: dist/docs/.
  copy: [{ from: [`${docs}/**/*.md`, `!${docs}/node_modules/**`], to: 'dist', flatten: false }]
})
