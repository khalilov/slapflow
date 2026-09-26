import { type ResolveScope } from '~/helpers/path/resolveScope'
import { childPath } from '~/helpers/path/childPath'
import { resolveExpressionValue } from '~/helpers/path/resolveExpressionValue'
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
    return value.map((item, index) => resolveValue(item, scope, childPath(path, index)))
  }
  if (!isRecord(value)) {
    return value
  }
  if (Object.prototype.hasOwnProperty.call(value, '$expression')) {
    return resolveExpressionValue(value.$expression, scope, path, resolveValue)
  }
  if (isString(value.$template)) {
    return resolveTemplateValue(value.$template, scope, path)
  }

  return resolveNestedObject(value, scope, path, resolveValue)
}
