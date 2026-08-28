import { type BusEvent } from '~/types'

export const isBusEvent = (event: unknown): event is BusEvent => {
  if (!event || typeof event !== 'object') {
    return false
  }

  const candidate = event as Record<string, unknown>

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.topic === 'string' &&
    typeof candidate.occurredAt === 'number' &&
    typeof candidate.serialized === 'string' &&
    'parsed' in candidate &&
    (candidate.origin === undefined || typeof candidate.origin === 'string')
  )
}
