import type { ClientSession } from 'mongodb'

import { AsyncLocalStorage } from 'node:async_hooks'

/** The session of the Better Auth transaction that runs, for the code that runs inside it. */
const sessions = new AsyncLocalStorage<ClientSession>()

/**
 * The `ClientSession` of the Better Auth transaction that runs, or `undefined` outside of one. Code
 * that Better Auth runs inside its transaction, such as a `before` database hook, passes it to its
 * own operations to join the transaction: without it, an operation commits on its own, and a later
 * failure of the request does not roll it back.
 *
 * @example
 *   export const auth = betterAuth({
 *     databaseHooks: {
 *       user: {
 *         create: {
 *           async before(user) {
 *             const session = transactionSession()
 *             const deleted = await UsersModel.findOne(
 *               { deletedAt: { $exists: true }, email: user.email },
 *               { session }
 *             )
 *
 *             if (!deleted) return undefined
 *
 *             await UsersModel.deleteOne(
 *               { _id: deleted._id, deletedAt: { $exists: true } },
 *               { session }
 *             )
 *
 *             return { data: { ...user, id: deleted._id } }
 *           }
 *         }
 *       }
 *     }
 *   })
 *
 * @see https://mongozod.dev/docs/integrations/better-auth#transactions
 */
export function transactionSession(): ClientSession | undefined {
  return sessions.getStore()
}

/** Runs the callback of a transaction with its session, which `transactionSession()` returns. */
export function runWithSession<T>(session: ClientSession, callback: () => T): T {
  return sessions.run(session, callback)
}
