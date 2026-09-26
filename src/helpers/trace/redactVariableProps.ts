import { dependsOnVariables } from '~/helpers/trace/dependsOnVariables'
import { isVariableRef } from '~/helpers/path/isVariableRef'
import { isRecord } from '~/helpers/type/isRecord'
import { isString } from '~/helpers/type/isString'

const isDerivedContainer = (value: Record<string, unknown>): boolean =>
  (isString(value.$template) || Object.prototype.hasOwnProperty.call(value, '$expression')) && dependsOnVariables(value)

export const redactVariableProps = (raw: unknown, resolved: unknown): unknown => {
  if (isVariableRef(raw)) {
    return '[REDACTED]'
  }
  if (isRecord(raw) && isDerivedContainer(raw)) {
    return '[REDACTED]'
  }
  if (Array.isArray(raw) && Array.isArray(resolved)) {
    return raw.map((item, index) => redactVariableProps(item, resolved[index]))
  }
  if (isRecord(raw) && isRecord(resolved)) {
    return Object.fromEntries(Object.entries(raw).map(([key, item]) => [key, redactVariableProps(item, resolved[key])]))
  }

  return resolved
}
