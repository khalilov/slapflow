import { isRecord } from '~/helpers/type/isRecord'
import { isString } from '~/helpers/type/isString'

export const getNextTarget = (next: unknown): string | undefined => {
  if (isString(next)) {
    return next
  }
  if (isRecord(next) && isString(next.strategy)) {
    return next.strategy
  }

  return undefined
}
