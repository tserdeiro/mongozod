/**
 * A key that is the same for the values MongoDB's `uniqueItems` takes as equal: numbers by their
 * value, BSON values by their `_bsontype` and JSON form, dates by their time, and objects by their
 * fields in any order.
 */
export function valueKey(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'bigint') return `n:${value}`
  if (value instanceof Date) return `d:${value.getTime()}`
  if (Array.isArray(value)) return `[${value.map(valueKey).join(',')}]`
  if (typeof value !== 'object' || value === null) return JSON.stringify(value ?? null)
  if ('_bsontype' in value) return `${String(value._bsontype)}:${JSON.stringify(value)}`

  const fields = Object.entries(value)
    .filter(([, field]) => field !== undefined)
    .map(([name, field]) => `${JSON.stringify(name)}:${valueKey(field)}`)

  return `{${fields.toSorted().join(',')}}`
}
