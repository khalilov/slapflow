import { pathReferenceRegex } from '~/helpers/path/pathReferenceRegex'

export const isValidPoolKey = (key: unknown): boolean => {
  if (typeof key === 'function') {
    return true
  }
  if (typeof key === 'string') {
    const match = key.match(pathReferenceRegex)

    return match !== null && match[1] === 'input'
  }
  return (
    typeof key === 'object' &&
    key !== null &&
    '$expression' in key &&
    Array.isArray(key.$expression) &&
    typeof key.$expression[0] === 'string'
  )
}
