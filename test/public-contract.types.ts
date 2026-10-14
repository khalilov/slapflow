import { type Runtime } from '~/index'

const optionalVariables: Omit<Runtime, 'variables'> extends Runtime ? true : false = true

void optionalVariables
