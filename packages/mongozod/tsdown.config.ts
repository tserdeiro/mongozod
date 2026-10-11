import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/bson.ts', 'src/mz.ts', 'src/plugins/soft-delete.ts'],
  dts: true,
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
