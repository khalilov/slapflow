import { type Config, type ValidationIssue } from '~/types'
import { getNextTarget } from '~/helpers/validation/getNextTarget'

export const detectCycles = (config: Config, errors: ValidationIssue[], warnings: ValidationIssue[]): void => {
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (id: string, path: string[]): boolean => {
    if (visiting.has(id)) {
      const cycle = [...path, id]
      const hasTerminal = cycle.some((item) => config.strategies[item]?.terminal)
      const issue = {
        code: 'CYCLE_DETECTED',
        message: `Cycle detected: ${cycle.join(' -> ')}`,
        strategy: id,
      }
      ;(hasTerminal ? warnings : errors).push(issue)
      return true
    }
    if (visited.has(id)) {
      return false
    }
    visiting.add(id)
    for (const branch of ['then', 'catch'] as const) {
      const nextItems = config.strategies[id]?.[branch]

      for (const next of Array.isArray(nextItems) ? nextItems : []) {
        const target = getNextTarget(next)

        if (target && config.strategies[target]) {
          visit(target, [...path, id])
        }
      }
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }

  Object.keys(config.strategies ?? {}).forEach((id) => visit(id, []))
}
