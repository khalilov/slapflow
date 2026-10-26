import { map } from 'objwalk'
import { type Resolve, type ResolveScope } from '~/helpers/path/resolveScope'
import { childPath } from '~/helpers/path/childPath'

export const resolveNestedObject = <TContext>(
  record: Record<string, unknown>,
  scope: ResolveScope<TContext>,
  path: string,
  resolve: Resolve<TContext>
): Record<string, unknown> =>
  map(record, (key, item: unknown) => resolve(item, scope, childPath(path, key)), { shallow: true })
