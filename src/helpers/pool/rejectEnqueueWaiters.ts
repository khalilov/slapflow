import { type EnqueueErrorCode, type PoolWaiter } from '~/types'
import { EnqueueError } from '~/helpers/errors/EnqueueError'

export const rejectEnqueueWaiters = (waiters: PoolWaiter[], code: EnqueueErrorCode): void => {
  for (const waiter of waiters) {
    waiter.reject(new EnqueueError(code, 'Enqueue request was cancelled'))
  }
}
