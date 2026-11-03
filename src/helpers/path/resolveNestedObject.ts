import { type Resolve, type ResolveScope } from '~/helpers/path/resolveScope'
import { childPath } from '~/helpers/path/childPath'

export const resolveNestedObject = <TContext>(
  record: Record<string, unknown>,
  scope: ResolveScope<TContext>,
  path: string,
  resolve: Resolve<TContext>
): Record<string, unknown> =>
  Object.fromEntries(
    Object.keys(record).map((key) => [key, resolve(Reflect.get(record, key), scope, childPath(path, key))])
  )
