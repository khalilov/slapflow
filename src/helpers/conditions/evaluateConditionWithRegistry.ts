import { each } from 'objwalk'
import {
  type ConditionEvaluationOptions,
  type ConditionExpression,
  type ConditionFn,
  type ConditionOutcome,
  type EvaluationScope,
  type ValidationIssue,
} from '~/types'
import { BUILTIN_CONDITIONS } from '~/helpers/conditions'
import { slapError } from '~/helpers/errors/slapError'
import { createEvaluationRuntime } from '~/helpers/path/createEvaluationRuntime'
import { evaluateConditionTree } from '~/helpers/conditions/evaluateConditionTree'
import { createReservedRegistry } from '~/helpers/registry/createReservedRegistry'
import { validateCondition } from '~/helpers/validation/validateCondition'

export const evaluateConditionWithRegistry = <TContext>(
  expression: unknown,
  { context, input = {}, data = {}, variables = {}, types, runtime, strategy, configPath }: EvaluationScope<TContext>,
  { conditions = {}, expressions = {} }: ConditionEvaluationOptions<TContext> = {},
  validatedConditions?: WeakSet<object>
): ConditionOutcome => {
  const scope = {
    context,
    input,
    data,
    variables,
    expressions,
    ...(types === undefined ? {} : { types }),
    ...(strategy === undefined ? {} : { strategy }),
  }
  const path = configPath ?? (strategy ? `strategies.${strategy}.when` : 'when')
  const { registry, register } =
    conditions instanceof Map
      ? { registry: conditions, register: undefined }
      : createReservedRegistry(BUILTIN_CONDITIONS as readonly [string, ConditionFn<TContext>][], 'condition')
  const evaluationScope = { ...scope, runtime: runtime ?? createEvaluationRuntime(scope), configPath: path }

  if (types !== undefined && runtime !== undefined && Array.isArray(expression)) {
    const typedRuntime = createEvaluationRuntime(scope)

    evaluationScope.runtime = { ...evaluationScope.runtime, get: typedRuntime.get, resolve: typedRuntime.resolve }
  }

  try {
    if (conditions instanceof Map === false && register !== undefined) {
      each(
        conditions,
        (name, condition) => {
          register(name, condition)
        },
        { shallow: true }
      )
    }
    if (Array.isArray(expression) === false || validatedConditions?.has(expression) !== true) {
      const errors: ValidationIssue[] = []

      validateCondition(expression, strategy ?? '', path, registry, errors, { allowEnsure: true })
      if (errors.length === 0 && Array.isArray(expression)) {
        validatedConditions?.add(expression)
      }

      if (errors.length > 0) {
        const [issue] = errors
        const { code, message, path } = issue!

        return {
          ok: false,
          error: slapError(code, message, {
            ...(path === undefined ? {} : { path }),
            ...(strategy === undefined ? {} : { strategy }),
          }),
        }
      }
    }

    return evaluateConditionTree(expression as ConditionExpression | undefined, registry, evaluationScope)
  } catch (cause) {
    return {
      ok: false,
      error: slapError('CONDITION_THROWN', 'Condition evaluation failed', {
        from: cause,
        ...(strategy === undefined ? {} : { strategy }),
        path,
      }),
    }
  }
}
