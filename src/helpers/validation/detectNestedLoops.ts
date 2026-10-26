import { each } from 'objwalk'
import { type Config, type ValidationIssue } from '~/types'
import { getNextItems } from '~/helpers/validation/getNextItems'
import { getNextTarget } from '~/helpers/validation/getNextTarget'

export const detectNestedLoops = (config: Config, errors: ValidationIssue[]): void => {
  each(
    config.strategies,
    (outerId, outer) => {
      if (outer.fn === 'core.loop') {
        const visited = new Set<string>([outerId])

        const visit = (id: string, path: string[]): void => {
          const strategy = config.strategies[id]

          if (strategy) {
            if (strategy.fn === 'core.loop') {
              errors.push({
                code: 'NESTED_LOOP',
                message: `Strategy "${id}" cannot run inside loop "${outerId}". Nested core.loop strategies are not supported.`,
                strategy: id,
                path: [...path, id].join(' -> '),
              })
            } else if (visited.has(id) === false) {
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
    },
    { shallow: true }
  )
}
