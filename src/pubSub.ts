import {
  type Bus,
  type BusErrorEvent,
  type BusEvent,
  type BusEmitOptions,
  type BusOptions,
  type EventMap,
  type EventName,
} from '~/types'
import { createId } from '~/helpers/ids/createId'
import { isBusEvent } from '~/helpers/pubSub/isBusEvent'
import { matchesTopic } from '~/helpers/pubSub/matchesTopic'
import { serializeError } from '~/helpers/pubSub/serializeError'

export const createPubSub = <TEvents extends object = EventMap>(
  options: BusOptions<TEvents> = {}
): Bus<TEvents> => {
  const subscribers = new Map<string, Set<(event: BusEvent<unknown>) => void>>()
  const wildcardSubscribers = new Map<string, Set<(event: BusEvent<unknown>) => void>>()

  const runHandler = (event: BusEvent, handler: (event: BusEvent<unknown>) => void): void => {
    try {
      handler(event as BusEvent<unknown>)
    } catch (error) {
      options.onError?.({ type: 'subscriber', event, error } as BusErrorEvent<TEvents>)
    }
  }

  const dispatch = (event: unknown): BusEvent | undefined => {
    let dispatchedEvent: BusEvent | undefined

    if (!isBusEvent(event)) {
      options.onError?.({
        type: 'serialization',
        topic: 'unknown' as EventName<TEvents>,
        payload: event as TEvents[EventName<TEvents>],
        error: new Error('Invalid bus event'),
      })
    } else {
      const handlers = subscribers.get(event.topic)

      if (handlers) {
        for (const handler of [...handlers]) {
          runHandler(event, handler)
        }
      }

      for (const [pattern, wildcardHandlers] of wildcardSubscribers) {
        if (matchesTopic(event.topic, pattern)) {
          for (const handler of [...wildcardHandlers]) {
            runHandler(event, handler)
          }
        }
      }
      dispatchedEvent = event
    }

    return dispatchedEvent
  }

  const on = (event: string, handler: (event: BusEvent<unknown>) => void) => {
    const registry = event.includes('*') ? wildcardSubscribers : subscribers
    const handlers = registry.get(event) ?? new Set<(event: BusEvent<unknown>) => void>()

    handlers.add(handler)
    registry.set(event, handlers)

    return () => off(event, handler)
  }

  const off = (event: string, handler?: (event: BusEvent<unknown>) => void) => {
    const registry = event.includes('*') ? wildcardSubscribers : subscribers

    if (handler) {
      const handlers = registry.get(event)

      if (handlers) {
        handlers.delete(handler)
        if (handlers.size === 0) {
          registry.delete(event)
        }
      }
    } else {
      registry.delete(event)
    }
  }

  const emit = <TEvent extends EventName<TEvents>>(
    topic: TEvent,
    payload: TEvents[TEvent],
    emitOptions: BusEmitOptions = {}
  ): BusEvent<TEvents[TEvent]> => {
    let event: BusEvent<TEvents[TEvent]>

    try {
      const serialized = JSON.stringify(payload)
      if (typeof serialized !== 'string') {
        throw new Error('Payload cannot be serialized')
      }
      event = {
        id: createId(),
        topic,
        occurredAt: Date.now(),
        ...(emitOptions.origin ? { origin: emitOptions.origin } : {}),
        parsed: payload,
        serialized,
      }
    } catch (error) {
      const parsed = serializeError(error)
      event = {
        id: createId(),
        topic,
        occurredAt: Date.now(),
        ...(emitOptions.origin ? { origin: emitOptions.origin } : {}),
        parsed: parsed as TEvents[TEvent],
        serialized: JSON.stringify(parsed),
      }
      options.onError?.({
        type: 'serialization',
        topic,
        payload,
        ...(emitOptions.origin ? { origin: emitOptions.origin } : {}),
        error,
      } as BusErrorEvent<TEvents>)
    }

    return dispatch(event) as BusEvent<TEvents[TEvent]>
  }

  return { on, off, emit, dispatch }
}

export const PubSub = createPubSub()
