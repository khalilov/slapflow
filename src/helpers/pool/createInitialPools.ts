import { each } from 'objwalk'
import { type Pool, type PoolOptions } from '~/types'
import { createPool } from '~/helpers/pool/createPool'

export const createInitialPools = (pools: Record<string, PoolOptions>): Map<string, Pool> => {
  const byName = new Map<string, Pool>()

  each(
    pools,
    (name, { workers, maxQueueSize, overflow, events, eventsMinInterval }) => {
      byName.set(
        name,
        createPool({
          name,
          named: true,
          workers,
          maxQueueSize: maxQueueSize ?? Infinity,
          overflow: overflow ?? 'wait',
          events: events ?? 'off',
          eventsMinInterval: eventsMinInterval ?? 0,
        })
      )
    },
    { shallow: true }
  )

  return byName
}
