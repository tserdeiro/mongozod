import type * as core from 'zod/v4/core'

import { z } from 'zod'

/**
 * Parses each item of a batch, such as the documents of `insertMany`, and throws one `ZodError`
 * with the issues of every item that fails, each under its index. Other errors propagate.
 */
export async function parseEach<T, R>(
  items: readonly T[],
  parse: (item: T) => Promise<R>
): Promise<R[]> {
  const results = await Promise.allSettled(items.map(parse))
  const issues: core.$ZodIssue[] = []

  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') continue
    if (!(result.reason instanceof z.ZodError)) throw result.reason

    for (const issue of result.reason.issues) {
      issues.push(Object.assign({}, issue, { path: [index, ...issue.path] }))
    }
  }

  if (issues.length > 0) throw new z.ZodRealError(issues)

  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
}
