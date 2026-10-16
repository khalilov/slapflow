import { pick, set } from 'objwalk'
import { type Runtime } from '~/types'
import { type ResolveScope } from '~/helpers/path/resolveScope'
import { protectedPickOptions } from '~/helpers/path/protectedPickOptions'
import { resolveValue } from '~/helpers/path/resolveValue'
import { terminalFieldName } from '~/helpers/path/terminalFieldName'
import { assertFieldType } from '~/helpers/type/assertFieldType'

type EvaluationRuntimeScope<TContext> = ResolveScope<TContext> & { closed?: boolean }

export const createEvaluationRuntime = <TContext>(
  scope: EvaluationRuntimeScope<TContext>
): Pick<Runtime, 'get' | 'data' | 'variables' | 'resolve'> => ({
  get: (path) =>
    scope.types === undefined
      ? pick(scope.context as Record<string, unknown>, path)
      : assertFieldType(
          pick(scope.context as Record<string, unknown>, path),
          terminalFieldName(path),
          `context.${path}`,
          scope
        ),
  data: {
    get: (path) => pick(scope.data, path),
    set: (path, value) => {
      if (scope.closed === undefined || scope.closed === false) {
        set(scope.data, path, value)
      }
    },
  },
  variables: { get: (path) => pick(scope.variables ?? {}, path, protectedPickOptions) },
  resolve: (value) => resolveValue(value, scope),
})
