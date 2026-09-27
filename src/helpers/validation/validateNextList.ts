import { type Config, type Props, type ValidationIssue } from '~/types'
import { getNextTarget } from '~/helpers/validation/getNextTarget'
import { validateCondition } from '~/helpers/validation/validateCondition'
import { validateRefs } from '~/helpers/validation/validateRefs'
import { type RegistryReader } from '~/helpers/validation/registryReader'
import { isRecord } from '~/helpers/type/isRecord'

export const validateNextList = (
  config: Config,
  list: unknown,
  path: string,
  strategy: string,
  conditionsRegistry: RegistryReader,
  errors: ValidationIssue[]
): void => {
  if (list === undefined) {
    return
  }
  if (!Array.isArray(list)) {
    errors.push({ code: 'NEXT_INVALID', message: 'then/catch must be arrays', strategy, path })
    return
  }
  list.forEach((item, index) => {
    const target = getNextTarget(item)
    const named = target === undefined ? undefined : config.strategies[target]

    if (!named) {
      errors.push({
        code: 'STRATEGY_NOT_FOUND',
        message: `Next strategy "${String(target)}" is not defined`,
        strategy,
        path: `${path}.${index}`,
      })
      return
    }
    if (isRecord(item)) {
      const { props, when } = item as { props?: Props; when?: unknown }

      validateCondition(when, strategy, `${path}.${index}.when`, conditionsRegistry, errors)
      validateRefs(props, strategy, `${path}.${index}.props`, errors)
    }
  })
}
