import { type ConditionExpression, type ConditionFn, type ConditionOutcome, type Runtime } from '~/types'
import { slapError } from '~/helpers/errors/slapError'
import { type ResolveScope } from '~/helpers/path/resolveScope'
import { resolveValue } from '~/helpers/path/resolveValue'

type ConditionTreeScope<TContext> = ResolveScope<TContext> & {
  runtime: Pick<Runtime, 'resolve' | 'get' | 'data' | 'variables'>
  configPath: string
}

export const evaluateConditionTree = <TContext>(
  expression: ConditionExpression | undefined,
  registry: Map<string, ConditionFn<TContext>>,
  scope: ConditionTreeScope<TContext>
): ConditionOutcome => {
  const { configPath, strategy } = scope

  if (Array.isArray(expression)) {
    const [operator, ...rawArgs] = expression
    const condition = registry.get(operator)

    if (operator === 'and' || operator === 'or') {
      let index = 0
      let ensured = false
      let outcome: ConditionOutcome = { ok: true, matched: operator === 'and' }

      while (index < rawArgs.length && outcome.ok && outcome.matched === (operator === 'and')) {
        outcome = evaluateConditionTree(rawArgs[index] as ConditionExpression, registry, scope)
        if (outcome.ok && outcome.ensure) {
          ensured = true
        }
        index += 1
      }
      if (outcome.ok && outcome.matched === false && ensured) {
        return { ok: true, matched: false, ensure: true }
      }

      return outcome
    }
    if (operator === 'not') {
      const outcome = evaluateConditionTree(rawArgs[0] as ConditionExpression, registry, scope)

      return outcome.ok ? { ok: true, matched: !outcome.matched } : outcome
    }
    if (operator === 'ensure') {
      const outcome = evaluateConditionTree(rawArgs[0] as ConditionExpression, registry, scope)

      return outcome.ok && outcome.matched === false ? { ok: true, matched: false, ensure: true } : outcome
    }

    if (condition) {
      const args = rawArgs.map((arg, index) =>
        resolveValue(arg, { ...scope, configPath: `${configPath}[${index + 1}]` })
      )

      return { ok: true, matched: Boolean(condition(scope, ...args)) }
    }

    return {
      ok: false,
      error: slapError('CONDITION_NOT_FOUND', `Condition "${operator}" is not registered`, {
        ...(strategy === undefined ? {} : { strategy }),
      }),
    }
  }

  return { ok: true, matched: expression ?? true }
}
