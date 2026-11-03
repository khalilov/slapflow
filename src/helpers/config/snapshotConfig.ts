import { type Config } from '~/types'
import { freezeConfigValue } from '~/helpers/config/freezeConfigValue'

export const snapshotConfig = (config: Config): Config => {
  const copies = new WeakMap<object, object>()
  const copyValue = <T>(value: T): T => {
    if (value !== null && typeof value === 'object') {
      const existing = copies.get(value)
      const copy = existing ?? (Array.isArray(value) ? new Array(value.length) : {})

      if (existing === undefined) {
        copies.set(value, copy)
        for (const key of Reflect.ownKeys(value)) {
          const descriptor = Object.getOwnPropertyDescriptor(value, key)

          if (descriptor?.enumerable === true) {
            Object.defineProperty(copy, key, {
              value: copyValue(Reflect.get(value, key)),
              enumerable: true,
              configurable: true,
              writable: true,
            })
          }
        }
      }

      return copy as T
    }

    return value
  }

  const snapshot = copyValue(config)

  // Conditions can retain types; the remaining snapshot stays private to the runner.
  freezeConfigValue(snapshot.types)

  return snapshot
}
