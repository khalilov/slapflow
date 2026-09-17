import { type Pool, type PoolLine, type PoolTask } from '~/types'

export type OldestQueuedTask = {
  line: PoolLine
  task: PoolTask
}

export const findOldestQueuedTask = (pool: Pool): OldestQueuedTask | undefined => {
  let oldest: OldestQueuedTask | undefined

  for (const line of pool.lines.values()) {
    const head = line.queue[0]

    if (head && (oldest === undefined || head.enqueuedAt < oldest.task.enqueuedAt)) {
      oldest = { line, task: head }
    }
  }

  return oldest
}
