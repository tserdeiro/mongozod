import type { BetterAuthOptions } from 'better-auth'

import {
  authFlowTestSuite,
  caseInsensitiveTestSuite,
  joinsTestSuite,
  normalTestSuite,
  testAdapter,
  transactionsTestSuite,
  uuidTestSuite
} from '@better-auth/test-utils/adapter'
import { MongoClient, ObjectId } from 'mongodb'
import { inject, vi } from 'vitest'

import { mongozodAdapter } from './mongozod-adapter'

// The suites of the official MongoDB adapter, on the tables without a model: their tests change
// the options as they run, which the schema of a model would not take.
const client = new MongoClient(inject('mongoUri'))
const db = client.db('mongozod-better-auth-suite')

await client.connect()

let current: { adapter: ReturnType<typeof mongozodAdapter>; key: string } | undefined

const { execute } = await testAdapter({
  // As the official adapter's tests: a new adapter for new options, on collections without the
  // indexes of the previous ones, once their builds end.
  async adapter(options: BetterAuthOptions) {
    const key = JSON.stringify(options)

    if (current?.key === key) return current.adapter

    await vi.waitFor(
      async () => {
        // The name of a command is its first key.
        // oxlint-disable-next-line sort-keys
        const command = { 'currentOp': true, 'command.createIndexes': { $exists: true } }
        const { inprog } = await client.db('admin').command(command)

        if (inprog.length > 0) throw new Error('An index build is still running')
      },
      { timeout: 10_000 }
    )

    const collections = await db.listCollections({}, { nameOnly: true }).toArray()

    await Promise.all(collections.map(({ name }) => db.collection(name).dropIndexes()))

    const adapter = mongozodAdapter({ client, db })

    current = { adapter, key }

    return adapter
  },
  customIdGenerator: () => new ObjectId().toHexString(),
  async onFinish() {
    await client.close()
  },
  runMigrations() {},
  tests: [
    normalTestSuite(),
    authFlowTestSuite(),
    transactionsTestSuite(),
    joinsTestSuite(),
    caseInsensitiveTestSuite(),
    uuidTestSuite()
  ]
})

execute()
