import { type StrategyTiming, type StrategyTimingNode } from '~/types'

export const buildTimingTree = (timings: readonly StrategyTiming[]): StrategyTimingNode[] => {
  const nodes = new Map<number, StrategyTimingNode>()
  const roots: StrategyTimingNode[] = []
  const sorted = [...timings].sort((left, right) => left.invocationId - right.invocationId)

  for (const timing of sorted) {
    const { invocationId, parentInvocationId } = timing
    const node: StrategyTimingNode = { ...timing, children: [] }
    const parent = parentInvocationId === null ? undefined : nodes.get(parentInvocationId)

    nodes.set(invocationId, node)

    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}
