import {
  type ActionArgs,
  type ActionResult,
  type FetchResponseType,
  type RetryOptions,
} from '~/types'
import { getRetryDelay } from '~/helpers/retry/getRetryDelay'
import { waitForRetry } from '~/helpers/retry/waitForRetry'

const defaultMaxAttempts = 2
const retryableStatuses = new Set([408, 425, 429])
const credentialsValues = new Set<globalThis.RequestCredentials>(['include', 'same-origin', 'omit'])

const responseReaders = {
  json: (response: Response) => response.json(),
  text: (response: Response) => response.text(),
  blob: (response: Response) => response.blob(),
  arrayBuffer: (response: Response) => response.arrayBuffer(),
  none: async () => undefined,
} satisfies Record<FetchResponseType, (response: Response) => Promise<unknown>>

export const coreFetch = async <TContext, TPatch>({
  props,
  runtime,
  signal,
}: ActionArgs<TContext>): Promise<ActionResult<TContext, TPatch>> => {
  const {
    acceptStatuses,
    body,
    contextPath,
    credentials,
    dataPath,
    headers,
    method,
    response,
    retry: retryProps,
    retryStatuses,
    url,
  } = props
  const responseType = typeof response === 'string' ? response : 'json'
  const retry = (retryProps ?? {}) as RetryOptions
  const maxAttempts = Math.max(0, Number(retry.maxAttempts ?? defaultMaxAttempts))
  const acceptedStatusSet = Array.isArray(acceptStatuses) ? new Set(acceptStatuses) : undefined
  const retryStatusSet = Array.isArray(retryStatuses) ? new Set(retryStatuses) : undefined
  const requestCredentials = typeof credentials === 'string' ? credentials : undefined

  if (typeof url !== 'string' || !url) {
    return runtime.fail('core.fetch requires a non-empty url')
  }
  if (!Object.prototype.hasOwnProperty.call(responseReaders, responseType)) {
    return runtime.fail('core.fetch response must be json, text, blob, arrayBuffer, or none')
  }
  if (
    credentials !== undefined &&
    (typeof credentials !== 'string' || !credentialsValues.has(credentials as RequestCredentials))
  ) {
    return runtime.fail('core.fetch credentials must be include, same-origin, or omit')
  }

  for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
    try {
      const request: RequestInit = {
        signal,
        ...(typeof method === 'string' ? { method } : {}),
        ...(requestCredentials ? { credentials: requestCredentials as RequestCredentials } : {}),
        ...(headers ? { headers: headers as HeadersInit } : {}),
        ...(body === undefined ? {} : { body: body as BodyInit | null }),
      }
      const response = await fetch(url, request)
      const accepted = acceptedStatusSet?.has(response.status) ?? response.ok

      if (accepted) {
        let responseBody: unknown

        try {
          responseBody = await responseReaders[responseType as FetchResponseType](response)
        } catch (cause) {
          return runtime.fail('Fetch response could not be parsed', { cause })
        }
        const result = {
          status: response.status,
          ok: response.ok,
          headers: Object.fromEntries(response.headers),
          body: responseBody,
        }

        if (typeof dataPath === 'string') {
          runtime.data.set(dataPath, result)
        }
        if (typeof contextPath === 'string') {
          runtime.set(contextPath, result)
        }

        return
      }
      const retryableStatus =
        retryStatusSet?.has(response.status) ?? (retryableStatuses.has(response.status) || response.status >= 500)
      if (attempt === maxAttempts || !retryableStatus) {
        return runtime.fail(`Fetch request failed with status ${response.status}`, { status: response.status })
      }
    } catch (cause) {
      if (signal.aborted) {
        return false
      }
      if (attempt === maxAttempts) {
        return runtime.fail('Fetch request failed', { cause })
      }
    }

    try {
      await waitForRetry(getRetryDelay(attempt, retry), signal)
    } catch (cause) {
      return signal.aborted ? false : runtime.fail('Fetch retry was interrupted', { cause })
    }
  }
}
