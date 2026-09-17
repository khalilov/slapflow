import { type ConcurrencyKey, type ExpressionOperator, type Input } from '~/types'
import { isValidPoolKey } from '~/helpers/pool/isValidPoolKey'
import { resolveValue } from '~/helpers/path/resolveValue'

export const resolvePoolKey = <TPayload>(
  key: ConcurrencyKey<TPayload> | null | undefined,
  payload: TPayload,
  expressions: Record<string, ExpressionOperator> | undefined
): string | undefined => {
  if (key === undefined || key === null) {
    return undefined
  }
  if (!isValidPoolKey(key)) {
    return undefined
  }
  const resolved =
    typeof key === 'function'
      ? key(payload)
      : resolveValue(key, {
          context: undefined,
          data: {},
          input: payload as Input,
          expressions: expressions ?? {},
        })

  return typeof resolved === 'string' ? resolved : undefined
}
