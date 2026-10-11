import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/mzod.ts', 'src/plugins/soft-delete.ts'],
  dts: true,
  // One file per module, so a bundler drops the modules an app does not use, such as the `bson`
  // fields of `mongozod/mzod` when a client only builds inputs.
  unbundle: true,
  // Writes the `exports` field of package.json from the entries.
  exports: true,
  // Their errors fail the build. Not `failOnWarn`: the declarations are emitted with TypeScript 7,
  // whose API rolldown-plugin-dts still warns is experimental.
  publint: {
    strict: true
  },
  attw: {
    profile: 'esm-only',
    level: 'error'
  }
})
