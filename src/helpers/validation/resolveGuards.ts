import { type ConditionExpression, type Config, type Next, type Props } from '~/types'

export type GuardIssue = {
  code: 'GUARD_NOT_FOUND' | 'GUARD_CYCLE' | 'GUARD_INVALID'
  message: string
  guard?: string
  path?: string
}

const isGuardRef = (expression: unknown): expression is ['guard', string] =>
  Array.isArray(expression) && expression.length === 2 && expression[0] === 'guard' && typeof expression[1] === 'string'

const resolveRef = (
  config: Config,
  name: string,
  visiting: string[],
  path: string
): { expression?: ConditionExpression; issue?: GuardIssue } => {
  if (visiting.includes(name)) {
    return { issue: { code: 'GUARD_CYCLE', message: `Guard "${name}" is part of a reference cycle`, guard: name, path } }
  }
  const guard = config.guards?.[name]
  if (guard === undefined) {
    return { issue: { code: 'GUARD_NOT_FOUND', message: `Guard "${name}" is not defined`, guard: name, path } }
  }
  return resolveExpression(config, guard, [...visiting, name], path)
}

const resolveExpression = (
  config: Config,
  expression: ConditionExpression,
  visiting: string[],
  path: string
): { expression?: ConditionExpression; issue?: GuardIssue } => {
  if (isGuardRef(expression)) {
    return resolveRef(config, expression[1], visiting, path)
  }
  if (!Array.isArray(expression) || typeof expression[0] !== 'string') {
    return { expression }
  }

  const [operator, ...args] = expression

  if (operator === 'and' || operator === 'or') {
    const resolved: ConditionExpression[] = []
    for (let index = 0; index < args.length; index += 1) {
      const result = resolveExpression(config, args[index] as ConditionExpression, visiting, `${path}.${index + 1}`)
      if (result.issue) {
        return result
      }
      resolved.push(result.expression!)
    }
    return { expression: [operator, ...resolved] as ConditionExpression }
  }

  if (operator === 'not') {
    const result = resolveExpression(config, args[0] as ConditionExpression, visiting, `${path}.1`)
    if (result.issue) {
      return result
    }
    return { expression: ['not', result.expression] as ConditionExpression }
  }

  return { expression }
}

export const resolveGuards = (config: Config): { config: Config; issues: GuardIssue[] } => {
  const issues: GuardIssue[] = []

  const resolveWhen = (when: ConditionExpression | undefined, path: string): ConditionExpression | undefined => {
    if (when === undefined) {
      return undefined
    }
    const result = resolveExpression(config, when, [], path)
    if (result.issue) {
      issues.push(result.issue)
      return when
    }
    return result.expression
  }

  const resolveNext = (next: NonNullable<Config['strategies'][string]['then']>, prefix: string) =>
    next.map((item, index) => {
      if (typeof item === 'string' || !item || typeof item !== 'object' || (item as { when?: unknown }).when === undefined) {
        return item
      }
      const target = item as { strategy: string; props?: Props; when: ConditionExpression }
      const when = resolveWhen(target.when, `${prefix}.${index}.when`)
      return when === undefined ? item : ({ ...target, when } as Next)
    })

  const strategies: Config['strategies'] = {}

  for (const [id, strategy] of Object.entries(config.strategies)) {
    const when = strategy.when === undefined ? undefined : resolveWhen(strategy.when, `${id}.when`)

    strategies[id] = {
      ...strategy,
      ...(when !== undefined ? { when } : {}),
      ...(strategy.then ? { then: resolveNext(strategy.then, `${id}.then`) } : {}),
      ...(strategy.catch ? { catch: resolveNext(strategy.catch, `${id}.catch`) } : {}),
    }
  }

  return { config: { ...config, strategies }, issues }
}
