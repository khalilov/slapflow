export const typeIsCondition = (_args: unknown, value: unknown, expected: unknown): boolean => {
  if (expected === 'finite-number') {
    return typeof value === 'number' && Number.isFinite(value)
  }
  if (expected === 'array') {
    return Array.isArray(value)
  }
  if (expected === 'record') {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }
  return expected === 'string' || expected === 'number' || expected === 'boolean' ? typeof value === expected : false
}
