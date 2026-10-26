import { pick } from 'objwalk'

export const sizeOf = (value: unknown): number => {
  if (value !== null && value !== undefined) {
    if (typeof value === 'string' || Array.isArray(value)) {
      return value.length
    }
    if (value instanceof Map || value instanceof Set) {
      return value.size
    }
    if (typeof value === 'object') {
      return pick(value, '{*}').length
    }
  }
  return 0
}
