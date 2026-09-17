import { type Pool, type PoolOptions } from '~/types'
import { createPool } from '~/helpers/pool/createPool'

export const createInitialPools = (pools: Record<string, PoolOptions>): Map<string, Pool> => {
  const byName = new Map<string, Pool>()

  for (const [name, options] of Object.entries(pools)) {
    byName.set(
      name,
      createPool({
        name,
        named: true,
        workers: options.workers,
        maxQueueSize: options.maxQueueSize ?? Infinity,
        overflow: options.overflow ?? 'wait',
        events: options.events ?? 'off',
        eventsMinIntervalMs: options.eventsMinIntervalMs ?? 0,
      })
    )
  }

  return byName
}
