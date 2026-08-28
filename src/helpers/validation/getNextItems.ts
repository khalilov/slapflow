import { type Next } from '~/types'

export const getNextItems = (value: unknown): Next[] => (Array.isArray(value) ? value : [])
