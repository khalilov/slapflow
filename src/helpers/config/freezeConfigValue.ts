export const freezeConfigValue = (value: unknown): void => {
  if (value !== null && typeof value === 'object' && Object.isFrozen(value) === false) {
    Object.freeze(value)
    for (const key of Reflect.ownKeys(value)) {
      freezeConfigValue(Reflect.get(value, key))
    }
  }
}
