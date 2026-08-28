import { type ActionArgs, type ActionResult } from '~/types'

export const coreDelay = async <TContext, TPatch>({
  props,
  signal,
}: ActionArgs<TContext>): Promise<ActionResult<TContext, TPatch>> => {
  const ms = Math.max(0, Number(props.ms ?? 0))

  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (): void => {
      if (timer) {
        clearTimeout(timer)
      }
      signal.removeEventListener('abort', finish)
      resolve()
    }

    if (signal.aborted) {
      finish()
    } else {
      timer = setTimeout(finish, ms)
      signal.addEventListener('abort', finish, { once: true })
    }
  })
}
