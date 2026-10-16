import { existsCondition } from '~/helpers/conditions/existsCondition'
import { isRecord } from '~/helpers/type/isRecord'
import { assertFieldType } from '~/helpers/type/assertFieldType'
import { type EvaluationScope } from '~/types'

export const containsCondition = (
  { types }: Pick<EvaluationScope<unknown>, 'types'>,
  target: unknown,
  names: unknown
): boolean => {
  if (isRecord(target) && Array.isArray(names)) {
    const fields: string[] = [...names].filter((name): name is string => typeof name === 'string')

    if (fields.length === names.length) {
      return fields.every((name) => {
        if (Object.hasOwn(target, name)) {
          const value = assertFieldType(target[name], name, `contains.${name}`, { types })

          return existsCondition(undefined, value)
        }

        return false
      })
    }
  }

  return false
}
