import {
  type Bus,
  type BusErrorEvent,
  type BusEvent,
  type BusEmitOptions,
  type BusOptions,
  type EventHandler,
  type EventMap,
  type EventName,
} from '~/types'
import { createId } from '~/helpers/ids/createId'
import { isBusEvent } from '~/helpers/pubSub/isBusEvent'
import { serializeError } from '~/helpers/pubSub/serializeError'

export const createPubSub = <TEvents extends object = EventMap>(
  options: BusOptions<TEvents> = {}
): Bus<TEvents> => {
  const subscribers = new Map<string, Set<(event: BusEvent<unknown>) => void>>()

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
          try {
            handler(event as BusEvent<unknown>)
          } catch (error) {
            options.onError?.({ type: 'subscriber', event, error } as BusErrorEvent<TEvents>)
          }
        }
      }
      dispatchedEvent = event
    }

    return dispatchedEvent
  }

  const on = <TEvent extends EventName<TEvents>>(
    event: TEvent,
    handler: EventHandler<TEvents, TEvent>
  ) => {
    const handlers = subscribers.get(event) ?? new Set<(event: BusEvent<unknown>) => void>()
    const listener = handler as (event: BusEvent<unknown>) => void

    handlers.add(listener)
    subscribers.set(event, handlers)

    return () => off(event, handler)
  }

  const off = <TEvent extends EventName<TEvents>>(
    event: TEvent,
    handler?: EventHandler<TEvents, TEvent>
  ) => {
    if (handler) {
      const handlers = subscribers.get(event)

      if (handlers) {
        handlers.delete(handler as (event: BusEvent<unknown>) => void)
        if (handlers.size === 0) {
          subscribers.delete(event)
        }
      }
    } else {
      subscribers.delete(event)
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
