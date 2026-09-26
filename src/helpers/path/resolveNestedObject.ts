import { type Resolve, type ResolveScope } from '~/helpers/path/resolveScope'
import { childPath } from '~/helpers/path/childPath'

export const resolveNestedObject = <TContext>(
  record: Record<string, unknown>,
  scope: ResolveScope<TContext>,
  path: string,
  resolve: Resolve<TContext>
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).map(([key, item]) => [key, resolve(item, scope, childPath(path, key))]))
