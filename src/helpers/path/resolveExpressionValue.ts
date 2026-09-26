import { type Resolve, type ResolveScope } from '~/helpers/path/resolveScope'
import { childPath } from '~/helpers/path/childPath'
import { createResolutionError } from '~/helpers/path/createResolutionError'
import { evaluateExpression } from '~/helpers/path/evaluateExpression'

export const resolveExpressionValue = <TContext>(
  expression: unknown,
  scope: ResolveScope<TContext>,
  path: string,
  resolve: Resolve<TContext>
): unknown => {
  if (!Array.isArray(expression) || typeof expression[0] !== 'string') {
    throw createResolutionError('EXPRESSION_INVALID_ARGUMENT', 'Expression must contain an operator', scope, path)
  }
  const [operator, ...rawArgs] = expression
  const args = rawArgs.map((argument, index) =>
    resolve(argument, scope, childPath(childPath(path, '$expression'), index + 1))
  )

  return evaluateExpression(operator, args, scope.expressions ?? {}, {
    ...(scope.strategy ? { strategy: scope.strategy } : {}),
    path,
  })
}
