import {
  type EventMap,
  type SocketEventTopic,
  type WebSocketOptions,
  type WebSocketStatus,
  type WSClient,
} from '~/types'
import { getRetryDelay } from '~/helpers/retry/getRetryDelay'
import { createId } from '~/helpers/ids/createId'

export const createWebSocket = <TEvents extends object = EventMap>(options: WebSocketOptions<TEvents>): WSClient => {
  let socket: WebSocket | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryAttempt = 0
  let started = false
  let currentStatus: WebSocketStatus = 'idle'

  const emitSocketEvent = (topic: SocketEventTopic, payload: unknown): void => {
    options.bus.dispatch({
      id: createId(),
      topic,
      occurredAt: Date.now(),
      ...(options.origin ? { origin: options.origin } : {}),
      parsed: payload,
      serialized: JSON.stringify(payload),
    })
  }

  const scheduleRetry = (): void => {
    const delay = getRetryDelay(retryAttempt, options.reconnect ?? {})
    const attempt = retryAttempt + 1

    currentStatus = 'reconnecting'
    retryAttempt = attempt
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      connect()
    }, delay)
  }

  const connect = (): void => {
    if (!started || socket) {
      return
    }

    currentStatus = 'connecting'

    try {
      const current = new WebSocket(options.url, options.protocols ?? [])
      socket = current

      current.addEventListener('open', () => {
        if (socket === current) {
          retryAttempt = 0
          currentStatus = 'connected'
          emitSocketEvent('open', { url: options.url })
        }
      })

      current.addEventListener('message', (event) => {
        if (socket !== current) {
          return
        }
        let parsed: unknown = (event as MessageEvent).data
        if (typeof parsed === 'string') {
          try {
            parsed = JSON.parse(parsed)
          } catch {
            parsed = (event as MessageEvent).data
          }
        }
        emitSocketEvent('message', parsed)
      })

      current.addEventListener('close', (event) => {
        if (socket !== current) {
          return
        }
        socket = undefined
        emitSocketEvent('close', { code: (event as CloseEvent).code, reason: (event as CloseEvent).reason })
        if (started) {
          scheduleRetry()
        }
      })

      current.addEventListener('error', (event) => {
        emitSocketEvent('error', { error: event })
      })
    } catch (error) {
      socket = undefined
      emitSocketEvent('error', { error })
      if (started) {
        scheduleRetry()
      }
    }
  }

  const start = (): void => {
    if (!started) {
      started = true
      connect()
    }
  }

  const stop = (): void => {
    started = false
    if (retryTimer) {
      clearTimeout(retryTimer)
    }
    retryTimer = undefined
    const current = socket
    socket = undefined
    current?.close()
    currentStatus = 'stopped'
  }

  const reconnect = (): void => {
    if (!started) {
      return
    }
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
    const current = socket
    socket = undefined
    current?.close()
    connect()
  }

  return { start, stop, reconnect, status: () => currentStatus }
}
