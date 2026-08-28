import {
  type Bus,
  type EventMap,
  type EventName,
  type WS,
  type WSOptions,
  type WSSocket,
  type WSStatus,
} from '~/types'
import { getRetryDelay } from '~/helpers/retry/getRetryDelay'

const openState = 1
const maxSeenEvents = 1_000

export const createWS = <TEvents extends object = EventMap>(
  options: WSOptions<TEvents>
): WS => {
  const inboundTopics = new Set<string>(options.inboundTopics ?? [])
  const outboundTopics = new Set<string>(options.outboundTopics ?? [])
  const seenEventIds = new Set<string>()
  const outboundUnsubscribers = new Set<() => void>()
  const socketUnsubscribers = new Set<() => void>()
  let socket: WSSocket | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryAttempt = 0
  let started = false
  let currentStatus: WSStatus = 'idle'
  const diagnosticsBus = options.bus as unknown as Bus<EventMap>

  const emitDiagnostic = (topic: string, payload: Record<string, unknown>): void => {
    diagnosticsBus.emit(topic, payload, {
      ...(options.origin ? { origin: options.origin } : {}),
    })
  }

  const rememberEvent = (id: string): void => {
    seenEventIds.add(id)
    if (seenEventIds.size > maxSeenEvents) {
      const oldest = seenEventIds.values().next()

      if (!oldest.done) {
        seenEventIds.delete(oldest.value)
      }
    }
  }

  const clearSocket = (): void => {
    for (const unsubscribe of socketUnsubscribers) {
      unsubscribe()
    }
    socketUnsubscribers.clear()
    socket = undefined
  }

  const scheduleRetry = (reason: string, error?: unknown): void => {
    const maxAttempts = options.retry?.maxAttempts

    if (maxAttempts !== undefined && retryAttempt >= maxAttempts) {
      currentStatus = 'stopped'
      emitDiagnostic('slapflow.ws.disconnected', { reason: 'retry-limit-reached', attempt: retryAttempt })
    } else {
      const delay = getRetryDelay(retryAttempt, options.retry ?? {})
      const attempt = retryAttempt + 1
      const retry = (): void => {
        retryTimer = undefined
        connect()
      }

      currentStatus = 'retrying'
      retryAttempt = attempt
      retryTimer = setTimeout(retry, delay)
      emitDiagnostic('slapflow.ws.retrying', {
        reason,
        delay,
        attempt,
        ...(error === undefined ? {} : { error: String(error) }),
      })
    }
  }

  const connect = (): void => {
    if (started && !socket) {
      currentStatus = 'connecting'
      emitDiagnostic('slapflow.ws.connecting', { attempt: retryAttempt })

      try {
        const current = options.createSocket()
        socket = current
        const listen = (type: 'open' | 'close' | 'error' | 'message', listener: EventListener): void => {
          current.addEventListener(type, listener)
          socketUnsubscribers.add(() => current.removeEventListener(type, listener))
        }
        const disconnect = (reason: string): void => {
          if (socket === current) {
            clearSocket()

            if (started) {
              scheduleRetry(reason)
            }
          }
        }

        listen('open', () => {
          if (socket === current) {
            retryAttempt = 0
            currentStatus = 'connected'
            emitDiagnostic('slapflow.ws.connected', {})
          }
        })
        listen('close', () => disconnect('close'))
        listen('error', () => disconnect('error'))
        listen('message', (event) => {
          const data = (event as MessageEvent).data

          if (typeof data === 'string') {
            try {
              const busEvent = JSON.parse(data) as { topic?: string; id?: string }
              if (busEvent.topic && inboundTopics.has(busEvent.topic)) {
                if (busEvent.id) {
                  rememberEvent(busEvent.id)
                }
                if (!options.bus.dispatch(busEvent)) {
                  emitDiagnostic('slapflow.ws.message.rejected', { reason: 'invalid-envelope', topic: busEvent.topic })
                }
              } else {
                emitDiagnostic('slapflow.ws.message.rejected', { reason: 'topic-not-allowed', topic: busEvent.topic })
              }
            } catch (error) {
              emitDiagnostic('slapflow.ws.message.rejected', { reason: 'message-parse-failed', error: String(error) })
            }
          } else {
            emitDiagnostic('slapflow.ws.message.rejected', { reason: 'message-not-string' })
          }
        })
      } catch (error) {
        scheduleRetry('socket-create-failed', error)
      }
    }
  }

  const start = (): void => {
    if (!started) {
      started = true
      for (const topic of outboundTopics) {
        const unsubscribe = options.bus.on(topic as EventName<TEvents>, (event) => {
          if (!seenEventIds.delete(event.id) && event.origin !== options.origin && socket?.readyState === openState) {
            socket.send(JSON.stringify(event))
          }
        })
        outboundUnsubscribers.add(unsubscribe)
      }
      connect()
    }
  }

  const stop = (): void => {
    started = false
    if (retryTimer) {
      clearTimeout(retryTimer)
    }
    retryTimer = undefined
    for (const unsubscribe of outboundUnsubscribers) {
      unsubscribe()
    }
    outboundUnsubscribers.clear()
    const current = socket
    clearSocket()
    current?.close()
    currentStatus = 'stopped'
    emitDiagnostic('slapflow.ws.disconnected', { reason: 'stopped' })
  }

  const reconnect = (): void => {
    if (started) {
      if (retryTimer) {
        clearTimeout(retryTimer)
      }
      const current = socket

      retryTimer = undefined
      clearSocket()
      current?.close()
      connect()
    }
  }

  return { start, stop, reconnect, status: () => currentStatus }
}
