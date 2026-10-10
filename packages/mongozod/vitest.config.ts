import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // Nothing is implemented yet; remove once the first test lands.
    passWithNoTests: true
  }
})
