/**
 * The error of a field type of `mz`: its message, which says what it takes, and that nothing was
 * received when the field is missing, as Zod says it of a missing field.
 */
export function fieldError(message: string): (issue: { input?: unknown }) => string {
  return (issue) => (issue.input === undefined ? `${message}, received undefined` : message)
}
