import { type ExpressionOperator, type Input, type TypeRules, type Variables } from '~/types'

export type ResolveScope<TContext> = {
  context: TContext
  data: Record<string, unknown>
  input: Input
  variables?: Variables
  types?: TypeRules
  expressions?: Record<string, ExpressionOperator>
  strategy?: string
  configPath?: string
}

export type Resolve<TContext> = (value: unknown, scope: ResolveScope<TContext>, path: string) => unknown
