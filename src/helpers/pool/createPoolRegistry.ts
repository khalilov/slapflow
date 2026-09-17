import {
  type EnqueueErrorCode,
  type Pool,
  type PoolDefinition,
  type PoolLine,
  type PoolOptions,
  type PoolStats,
  type PoolTask,
  type PoolTaskInput,
  type PoolWaiter,
} from '~/types'
import { EnqueueError } from '~/helpers/errors/EnqueueError'
import { createInitialPools } from '~/helpers/pool/createInitialPools'
import { createPool } from '~/helpers/pool/createPool'
import { createReadyHeap } from '~/helpers/pool/createReadyHeap'
import { findOldestQueuedTask } from '~/helpers/pool/findOldestQueuedTask'
import { rejectEnqueueWaiters } from '~/helpers/pool/rejectEnqueueWaiters'

export type PoolRegistry = {
  submit(task: PoolTaskInput): Promise<void>
  enqueue(task: PoolTaskInput): Promise<void>
  ensurePrivatePool(definition: Omit<PoolDefinition, 'named'>): void
  definition(pool: string): PoolDefinition | undefined
  stats(): Record<string, PoolStats>
  inFlight(): number
  setDraining(value: boolean): void
  isDraining(): boolean
  rejectWaiters(code: EnqueueErrorCode): void
  reset(): PoolTask[]
  setDispatch(dispatch: (task: PoolTask, done: (status: string) => void) => void): void
}

export type PoolRegistryOptions = {
  pools: Record<string, PoolOptions>
  now: () => number
  onQueued: (task: PoolTask, queueDepth: number) => void
  onOverflow: (task: PoolTask, queueDepth: number) => void
  onDropped: (task: PoolTask, reason: string) => void
}

export const createPoolRegistry = (options: PoolRegistryOptions): PoolRegistry => {
  const pools = createInitialPools(options.pools)
  let draining = false
  let dispatch: (task: PoolTask, done: (status: string) => void) => void = () => undefined

  const requirePool = (name: string, namedOnly: boolean): Pool => {
    const pool = pools.get(name)

    if (!pool || (namedOnly && !pool.named)) {
      throw new EnqueueError('ENQUEUE_UNKNOWN_POOL', `Pool "${name}" is not configured`)
    }

    return pool
  }

  const refreshReady = (pool: Pool, line: PoolLine): void => {
    if (line.queue.length > 0) {
      line.readySeq = ++pool.seq
      pool.ready.push({ value: line, at: (line.queue[0] as PoolTask).enqueuedAt, seq: line.readySeq })
    }
  }

  const nextLine = (pool: Pool): PoolLine | undefined => {
    while (pool.ready.size() > 0) {
      const entry = pool.ready.pop()

      if (entry) {
        const line = entry.value

        if (line.readySeq === entry.seq && !line.active && line.queue.length > 0) {
          return line
        }
      }
    }

    return undefined
  }

  const insert = (pool: Pool, task: PoolTaskInput): PoolTask => {
    const entry: PoolTask = { ...task, enqueuedAt: options.now() }
    const line = pool.lines.get(task.key) ?? { key: task.key, queue: [], active: false, readySeq: 0 }

    pool.lines.set(task.key, line)

    if (task.coalesceToken !== undefined) {
      const index = line.queue.findIndex((queued) => queued.coalesceToken === task.coalesceToken)

      if (index >= 0) {
        line.queue[index] = entry
        if (index === 0) {
          refreshReady(pool, line)
        }
        options.onQueued(entry, pool.queued)
        return entry
      }
    }

    line.queue.push(entry)
    pool.queued += 1
    if (!line.active) {
      refreshReady(pool, line)
    }
    options.onQueued(entry, pool.queued)
    return entry
  }

  const releaseWaiters = (pool: Pool): void => {
    while (pool.waiters.length > 0 && pool.queued < pool.maxQueueSize) {
      const waiter = pool.waiters.shift() as PoolWaiter

      insert(pool, waiter.task)
      waiter.resolve()
    }
  }

  const dropOldest = (pool: Pool): void => {
    const oldest = findOldestQueuedTask(pool)

    if (oldest) {
      const { line, task } = oldest
      const index = line.queue.indexOf(task)

      line.queue.splice(index, 1)
      pool.queued -= 1
      if (index === 0) {
        if (line.queue.length > 0) {
          refreshReady(pool, line)
        } else if (!line.active) {
          pool.lines.delete(line.key)
        }
      }
      options.onDropped(task, 'queue-overflow')
    }
  }

  const pump = (pool: Pool): void => {
    while (pool.active < pool.workers) {
      const line = nextLine(pool)

      if (!line) {
        break
      }
      const task = line.queue.shift() as PoolTask

      pool.queued -= 1
      pool.active += 1
      line.active = true
      dispatch(task, () => {
        pool.active -= 1
        line.active = false
        if (line.queue.length > 0) {
          refreshReady(pool, line)
        } else {
          pool.lines.delete(line.key)
        }
        pump(pool)
        releaseWaiters(pool)
        pump(pool)
      })
    }
  }

  const core = (pool: Pool, task: PoolTaskInput): Promise<void> => {
    if (draining) {
      throw new EnqueueError('ENQUEUE_DRAINING', `Pool "${pool.name}" is draining`)
    }
    if (typeof task.key !== 'string') {
      throw new EnqueueError('ENQUEUE_KEY_INVALID', `Pool "${pool.name}" requires a string line key`)
    }
    const full = pool.queued >= pool.maxQueueSize

    if (full && pool.overflow === 'wait') {
      return new Promise<void>((resolve, reject) => {
        pool.waiters.push({ task, resolve, reject })
      })
    }
    if (full) {
      const entry: PoolTask = { ...task, enqueuedAt: options.now() }

      options.onOverflow(entry, pool.queued)
      if (pool.overflow === 'drop-oldest') {
        dropOldest(pool)
      } else {
        options.onDropped(entry, 'queue-overflow')
        return Promise.resolve()
      }
    }

    insert(pool, task)
    pump(pool)
    return Promise.resolve()
  }

  const stats = (): Record<string, PoolStats> => {
    const now = options.now()
    const byName: Record<string, PoolStats> = {}

    for (const pool of pools.values()) {
      const perKey: PoolStats['perKey'] = {}

      for (const line of pool.lines.values()) {
        const oldest = line.queue[0]?.enqueuedAt

        perKey[line.key] = {
          active: line.active ? 1 : 0,
          queued: line.queue.length,
          oldestQueuedMs: oldest === undefined ? 0 : Math.max(now - oldest, 0),
        }
      }
      const oldest = findOldestQueuedTask(pool)?.task.enqueuedAt ?? 0

      byName[pool.name] = {
        pool: pool.name,
        workers: pool.workers,
        active: pool.active,
        queued: pool.queued,
        oldestQueuedMs: oldest === 0 ? 0 : Math.max(now - oldest, 0),
        perKey,
      }
    }

    return byName
  }

  const inFlight = (): number => {
    let total = 0

    for (const pool of pools.values()) {
      total += pool.active + pool.queued
    }

    return total
  }

  const reset = (): PoolTask[] => {
    const dropped: PoolTask[] = []

    for (const pool of pools.values()) {
      for (const [key, line] of pool.lines) {
        if (line.queue.length > 0) {
          dropped.push(...line.queue)
          pool.queued -= line.queue.length
          line.queue = []
        }
        if (!line.active) {
          pool.lines.delete(key)
        }
      }
      pool.ready = createReadyHeap()
      pool.seq = 0
      rejectEnqueueWaiters(pool.waiters, 'ENQUEUE_DRAINING')
      pool.waiters = []
    }

    return dropped
  }

  return {
    submit: (task) => core(requirePool(task.pool, false), task),
    enqueue: (task) => core(requirePool(task.pool, true), task),
    ensurePrivatePool: (definition) => {
      if (!pools.has(definition.name)) {
        pools.set(definition.name, createPool({ ...definition, named: false }))
      }
    },
    definition: (pool) => pools.get(pool),
    stats,
    inFlight,
    setDraining: (value) => {
      draining = value
    },
    isDraining: () => draining,
    rejectWaiters: (code) => {
      for (const pool of pools.values()) {
        rejectEnqueueWaiters(pool.waiters, code)
        pool.waiters = []
      }
    },
    reset,
    setDispatch: (next) => {
      dispatch = next
    },
  }
}
