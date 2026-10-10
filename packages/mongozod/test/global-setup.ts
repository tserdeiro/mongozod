import type { TestProject } from 'vitest/node'

import { MongoMemoryReplSet } from 'mongodb-memory-server'

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string
  }
}

/**
 * Starts one MongoDB for the whole run, a single-member replica set because transactions need one,
 * and gives its URI to the tests through `inject('mongoUri')`.
 */
export async function setup({ provide }: TestProject) {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })

  provide('mongoUri', replSet.getUri())

  return async () => {
    await replSet.stop()
  }
}
