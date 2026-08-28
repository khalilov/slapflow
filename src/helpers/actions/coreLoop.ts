import { type ActionArgs, type ActionResult } from '~/types'
import { stopResult } from '~/helpers/runner/stopResult'

const defaultMax = 999

export const coreLoop = <TContext, TPatch>({
  props,
  signal,
  runtime,
}: ActionArgs<TContext>): Promise<ActionResult<TContext, TPatch>> =>
  new Promise<ActionResult<TContext, TPatch>>((resolve) => {
    const configuredDuration = Number(props.duration ?? 0)
    const duration = Number.isFinite(configuredDuration) ? Math.max(1, configuredDuration) : 1
    const configuredMax = Number(props.max ?? defaultMax)
    const max =
      configuredMax === -1
        ? Number.POSITIVE_INFINITY
        : Number.isFinite(configuredMax) && configuredMax >= 1
          ? Math.floor(configuredMax)
          : defaultMax
    const immediate = props.immediate === true
    let iterationCount = 0
    let running = false
    let stopped = false

    const finish = (result: ActionResult<TContext, TPatch>): void => {
      if (stopped) {
        return
      }
      stopped = true
      clearInterval(interval)
      signal.removeEventListener('abort', abort)
      resolve(result)
    }

    const abort = (): void => {
      clearInterval(interval)
      finish({ continue: false })
    }

    const tick = async (): Promise<void> => {
      if (running || signal.aborted) {
        return
      }

      running = true
      iterationCount += 1

      try {
        const result = await runtime.executeThen()

        if (result.status === 'failed') {
          const recovered = await runtime.executeCatch()

          if (recovered?.status === 'failed') {
            finish({ type: 'fail', reason: recovered.error.message, error: recovered.error, handled: true })
          } else if (recovered?.status === 'stopped') {
            finish(stopResult<TPatch>(recovered.reason))
          } else if (!recovered) {
            finish({ type: 'fail', reason: result.error.message, error: result.error })
          }
        } else if (result.status === 'stopped') {
          finish(stopResult<TPatch>(result.reason))
        }

        if (!stopped && iterationCount >= max) {
          finish({ continue: false })
        }
      } finally {
        running = false

        if (signal.aborted) {
          finish({ continue: false })
        }
      }
    }

    const interval = setInterval(() => {
      void tick().catch((error: unknown) => {
        finish({ type: 'fail', reason: 'core.loop tick failed', error })
      })
    }, duration)

    signal.addEventListener('abort', abort, { once: true })

    if (signal.aborted) {
      abort()
      return
    }

    if (immediate) {
      void tick().catch((error: unknown) => {
        finish({ type: 'fail', reason: 'core.loop tick failed', error })
      })
    }
  })
