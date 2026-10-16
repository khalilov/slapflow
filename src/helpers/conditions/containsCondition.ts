import { existsCondition } from '~/helpers/conditions/existsCondition'
import { isRecord } from '~/helpers/type/isRecord'

export const containsCondition = (_args: unknown, target: unknown, names: unknown): boolean => {
  if (isRecord(target) && Array.isArray(names)) {
    const fields: string[] = [...names].filter((name): name is string => typeof name === 'string')

    if (fields.length === names.length) {
      return fields.every((name) => {
        if (Object.hasOwn(target, name)) {
          return existsCondition(undefined, target[name])
        }

        return false
      })
    }
  }

  return false
}
