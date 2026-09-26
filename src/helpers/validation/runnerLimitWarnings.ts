import { type ValidationIssue } from '~/types'

type RunnerLimitOptions = {
  maxStepCount?: number
  maxSteps?: number
  maxDepth?: number
  maxSpawnDepth?: number
}

const limitWarning = (field: keyof RunnerLimitOptions, consequence: string): ValidationIssue => ({
  code: 'LIMIT_DISABLED',
  message: `${field} is disabled; ${consequence}`,
  path: `options.${field}`,
})

export const runnerLimitWarnings = (options: RunnerLimitOptions): ValidationIssue[] => {
  const warnings: ValidationIssue[] = []
  const maxStepCount = options.maxStepCount ?? options.maxSteps

  if (maxStepCount === -1) {
    warnings.push(limitWarning('maxStepCount', 'cycles or unexpectedly long runs may execute indefinitely'))
  }
  if (options.maxDepth === -1) {
    warnings.push(limitWarning('maxDepth', 'deeply nested strategies may exhaust the call stack'))
  }
  if (options.maxSpawnDepth === -1) {
    warnings.push(limitWarning('maxSpawnDepth', 'recursive core.invoke runs may execute indefinitely'))
  }

  return warnings
}
