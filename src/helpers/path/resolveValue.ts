import { map } from 'objwalk'
import { type ResolveScope } from '~/helpers/path/resolveScope'
import { childPath } from '~/helpers/path/childPath'
import { evaluateExpression } from '~/evaluateExpression'
import { ResolutionError } from '~/helpers/path/ResolutionError'
import { resolveNestedObject } from '~/helpers/path/resolveNestedObject'
import { resolvePathReference } from '~/helpers/path/resolvePathReference'
import { resolveTemplateValue } from '~/helpers/path/resolveTemplateValue'
import { isRecord } from '~/helpers/type/isRecord'
import { isString } from '~/helpers/type/isString'

export const resolveValue = <TContext>(
  value: unknown,
  scope: ResolveScope<TContext>,
  path = scope.configPath ?? ''
): unknown => {
  if (isString(value)) {
    return resolvePathReference(value, scope, path)
  }
  if (Array.isArray(value)) {
    return map(value, (index, item: unknown) => resolveValue(item, scope, childPath(path, index)), { shallow: true })
  }
  if (!isRecord(value)) {
    return value
  }
  if (Object.prototype.hasOwnProperty.call(value, '$expression')) {
    const result = evaluateExpression(
      value.$expression,
      { ...scope, configPath: path },
      { expressions: scope.expressions ?? {} }
    )

    if (result.ok) {
      return result.value
    }

    throw new ResolutionError(result.error)
  }
  if (isString(value.$template)) {
    return resolveTemplateValue(value.$template, scope, path)
  }

  return resolveNestedObject(value, scope, path, resolveValue)
}
