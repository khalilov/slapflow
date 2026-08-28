import { type Config, type ValidationIssue } from '~/types'
import { validateCondition } from '~/helpers/validation/validateCondition'
import { validateRefs } from '~/helpers/validation/validateRefs'
import { type RegistryReader } from '~/helpers/validation/registryReader'

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
    const target =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object'
          ? (item as { strategy?: unknown }).strategy
          : undefined

    if (typeof target !== 'string' || !config.strategies[target]) {
      errors.push({
        code: 'STRATEGY_NOT_FOUND',
        message: `Next strategy "${String(target)}" is not defined`,
        strategy,
        path: `${path}.${index}`,
      })
    } else if (item && typeof item === 'object') {
      const { props, when } = item as { props?: unknown; when?: unknown }

      validateCondition(when, strategy, `${path}.${index}.when`, conditionsRegistry, errors)
      validateRefs(props, strategy, `${path}.${index}.props`, errors)
    }
  })
}
