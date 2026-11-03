import { type ConditionEvaluationOptions, type ConditionOutcome, type EvaluationScope } from '~/types'
import { evaluateConditionWithRegistry } from '~/helpers/conditions/evaluateConditionWithRegistry'

export const evaluateCondition = <TContext>(
  expression: unknown,
  scope: EvaluationScope<TContext>,
  options: ConditionEvaluationOptions<TContext> = {}
): ConditionOutcome =>
  // Public arguments are always validated; only runner-owned snapshots can reuse validation.
  evaluateConditionWithRegistry(expression, scope, options)
