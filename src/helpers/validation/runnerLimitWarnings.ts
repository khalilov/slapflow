import { type ValidationIssue } from '~/types'

type RunnerLimitOptions = {
  maxStepCount?: number
  maxSteps?: number
  maxDepth?: number
}

export const runnerLimitWarnings = (options: RunnerLimitOptions): ValidationIssue[] => {
  const warnings: ValidationIssue[] = []
  const maxStepCount = options.maxStepCount ?? options.maxSteps

  if (maxStepCount === -1) {
    warnings.push({
      code: 'LIMIT_DISABLED',
      message: 'maxStepCount is disabled; cycles or unexpectedly long runs may execute indefinitely',
      path: 'options.maxStepCount',
    })
  }
  if (options.maxDepth === -1) {
    warnings.push({
      code: 'LIMIT_DISABLED',
      message: 'maxDepth is disabled; deeply nested strategies may exhaust the call stack',
      path: 'options.maxDepth',
    })
  }

  return warnings
}
