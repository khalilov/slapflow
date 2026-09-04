import {
  type EventMap,
  type SocketEventTopic,
  type WebSocketOptions,
  type WebSocketStatus,
  type WSClient,
} from '~/types'
import { getRetryDelay } from '~/helpers/retry/getRetryDelay'
import { createId } from '~/helpers/ids/createId'
import { serializeError } from '~/helpers/pubSub/serializeError'
import { parsePayload } from '~/helpers/parsePayload'

class WebSocketConnection<TEvents extends object = EventMap> implements WSClient {
  private _socket: WebSocket | undefined
  private _retryTimer: ReturnType<typeof setTimeout> | undefined
  private _retryAttempt = 0
  private _queue: string[] = []
  private _started = false
  private _status: WebSocketStatus = 'idle'

  constructor(private readonly options: WebSocketOptions<TEvents>) {}

  start(): void {
    if (!this._started) {
      this._started = true
      this.connect()
    }
  }

  stop(): void {
    this._started = false
    this.clearTimer()
    this.clearQueue()
    const current = this._socket
    this._socket = undefined
    current?.close()

    this.setStatus('stopped')
  }

  reconnect(): void {
    if (this._started) {
      this.clearTimer()
      const current = this._socket
      this._socket = undefined
      current?.close()
      this.connect()
    }
  }

  status(): WebSocketStatus {
    return this._status
  }

  send(data: string): void {
    if (this._socket?.readyState === WebSocket.OPEN) {
      this._socket.send(data)
    } else {
      this._queue.push(data)
    }
  }

  private connect(): void {
    if (!this._started || this._socket) {
      return
    }

    const { url, protocols } = this.options
    const current = new WebSocket(url, protocols ?? [])

    this._socket = current

    this.setStatus('connecting')

    current.addEventListener('open', () => this.onOpen(current))
    current.addEventListener('message', (event) => this.onMessage(current, event))
    current.addEventListener('close', (event) => this.onClose(current, event))
    current.addEventListener('error', (event) => this.onError(current, event))
  }

  private onOpen(current: WebSocket): void {
    if (this._socket === current) {
      this._retryAttempt = 0
      this.setStatus('connected')
      this.flush()
      this.dispatch('open', { url: this.options.url })
    }
  }

  private onMessage(current: WebSocket, event: Event): void {
    if (this._socket === current) {
      this.dispatch('message', parsePayload((event as MessageEvent).data))
    }
  }

  private onClose(current: WebSocket, event: Event): void {
    if (this._socket === current) {
      this._socket = undefined
      this.dispatch('close', event)
      if (this._started) {
        this.retry()
      }
    }
  }

  private onError(current: WebSocket, event: Event): void {
    if (this._socket === current) {
      this.dispatch('error', serializeError((event as ErrorEvent).error))
    }
  }

  private dispatch(topic: SocketEventTopic, parsed: unknown): void {
    const { bus, origin } = this.options

    bus.dispatch({
      id: createId(),
      topic,
      occurredAt: Date.now(),
      ...(origin ? { origin } : {}),
      parsed,
      serialized: JSON.stringify(parsed),
    })
  }

  private flush(): void {
    if (this._socket && this._socket.readyState === WebSocket.OPEN) {
      for (const message of this._queue) {
        this._socket.send(message)
      }

      this.clearQueue()
    }
  }

  private retry(): void {
    this.setStatus('reconnecting')
    this._retryTimer = setTimeout(
      () => {
        this._retryTimer = undefined
        this.connect()
      },
      getRetryDelay(this._retryAttempt, this.options.reconnect ?? {})
    )
    this._retryAttempt = this._retryAttempt + 1
  }

  private setStatus(status: WebSocketStatus): void {
    this._status = status || 'idle'
  }

  private clearQueue(): void {
    this._queue = []
  }

  private clearTimer(): void {
    if (this._retryTimer) {
      clearTimeout(this._retryTimer)
    }

    this._retryTimer = undefined
  }
}

export const createWebSocket = <TEvents extends object = EventMap>(options: WebSocketOptions<TEvents>): WSClient =>
  new WebSocketConnection<TEvents>(options)
