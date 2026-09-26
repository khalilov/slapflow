import { type Config, type Props, type ValidationIssue } from '~/types'
import { isPathReference } from '~/helpers/path/isPathReference'

export const validateInvoke = (
  config: Config,
  fn: unknown,
  props: Props,
  strategy: string,
  path: string,
  warnings: ValidationIssue[]
): void => {
  if (fn !== 'core.invoke') {
    return
  }
  const { entrypoint } = props

  if (typeof entrypoint !== 'string' || entrypoint.length === 0 || isPathReference(entrypoint)) {
    return
  }
  const target = config.entrypoints?.[entrypoint] ?? entrypoint

  if (!config.strategies[target]) {
    warnings.push({
      code: 'INVOKE_ENTRYPOINT_NOT_FOUND',
      message: `core.invoke target "${entrypoint}" is not defined`,
      strategy,
      path,
    })
  }
}
