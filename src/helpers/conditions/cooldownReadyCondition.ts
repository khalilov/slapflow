export const cooldownReadyCondition = (_args: unknown, now: unknown, lastAt: unknown, cooldown: unknown): boolean => {
  if (lastAt == null) {
    return true
  }
  return Number(now) - Number(lastAt) >= Number(cooldown ?? 0)
}
