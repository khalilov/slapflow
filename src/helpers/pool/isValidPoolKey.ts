import { type ConcurrencyKey } from '~/types'
import { pathReferenceRegex } from '~/helpers/path/pathReferenceRegex'

export const isValidPoolKey = <TPayload>(key: ConcurrencyKey<TPayload>): boolean => {
  if (typeof key === 'function') {
    return true
  }
  if (typeof key === 'string') {
    const match = key.match(pathReferenceRegex)

    return match !== null && match[1] === 'input'
  }
  return Array.isArray(key.$expression) && typeof key.$expression[0] === 'string'
}
