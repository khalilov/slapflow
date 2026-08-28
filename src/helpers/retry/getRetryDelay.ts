import { type RetryOptions } from '~/types'

export const getRetryDelay = (attempt: number, options: RetryOptions): number => {
  const { initialDelay = 500, maxDelay = 10_000, multiplier = 2, jitter } = options
  const delay = Math.min(initialDelay * multiplier ** attempt, maxDelay)

  return jitter === false ? delay : Math.round(delay * (0.5 + Math.random() * 0.5))
}
