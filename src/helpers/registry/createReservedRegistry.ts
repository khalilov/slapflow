export type ReservedRegistry<T> = {
  registry: Map<string, T>
  register(name: string, value: T): void
}

export const createReservedRegistry = <T>(builtins: readonly [string, T][], kind: string): ReservedRegistry<T> => {
  const reserved = new Set(builtins.map(([name]) => name))
  const registry = new Map<string, T>(builtins)

  const register = (name: string, value: T): void => {
    if (reserved.has(name)) {
      throw new Error(`Cannot override built-in ${kind} "${name}"`)
    }
    registry.set(name, value)
  }

  return { registry, register }
}
