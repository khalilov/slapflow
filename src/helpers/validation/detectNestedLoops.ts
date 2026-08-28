import { type Config, type ValidationIssue } from '~/types'
import { getNextItems } from '~/helpers/validation/getNextItems'
import { getNextTarget } from '~/helpers/validation/getNextTarget'

export const detectNestedLoops = (config: Config, errors: ValidationIssue[]): void => {
  for (const [outerId, outer] of Object.entries(config.strategies)) {
    if (outer.fn !== 'core.loop') {
      continue
    }

    const visited = new Set<string>([outerId])

    const visit = (id: string, path: string[]): void => {
      const strategy = config.strategies[id]

      if (!strategy) {
        return
      }

      if (strategy.fn === 'core.loop') {
        errors.push({
          code: 'NESTED_LOOP',
          message: `Strategy "${id}" cannot run inside loop "${outerId}". Nested core.loop strategies are not supported.`,
          strategy: id,
          path: [...path, id].join(' -> '),
        })
        return
      }

      if (visited.has(id)) {
        return
      }

      visited.add(id)

      for (const branch of ['then', 'catch'] as const) {
        for (const next of getNextItems(strategy[branch])) {
          const target = getNextTarget(next)
          if (target) {
            visit(target, [...path, `${id}.${branch}`])
          }
        }
      }
    }

    for (const branch of ['then', 'catch'] as const) {
      for (const next of getNextItems(outer[branch])) {
        const target = getNextTarget(next)
        if (target) {
          visit(target, [`${outerId}.${branch}`])
        }
      }
    }
  }
}
