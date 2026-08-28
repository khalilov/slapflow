import { type Config } from '~/types'

/** @deprecated Pass the configuration object directly to `createFlow` or `runner.loadConfig`. */
export const defineConfig = <TConfig extends Config>(config: TConfig): TConfig => config
