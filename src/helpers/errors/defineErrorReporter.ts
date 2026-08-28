import { type ErrorReporter, type ErrorReporterHandlers } from '~/types'

export const defineErrorReporter = <TContext, TPatch = unknown>(
  handlers: ErrorReporterHandlers<TContext, TPatch> | ErrorReporter<TContext, TPatch>
): ErrorReporter<TContext, TPatch> => (typeof handlers === 'function' ? handlers : handlers.report)
