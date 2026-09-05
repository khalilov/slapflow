export const matchesTopic = (topic: string, pattern: string): boolean => {
  if (pattern === '*') {
    return true
  }

  if (!pattern.includes('*')) {
    return topic === pattern
  }

  const topicParts = topic.split('.')
  const patternParts = pattern.split('.')

  if (topicParts.length !== patternParts.length) {
    return false
  }

  return patternParts.every((part, index) => part === '*' || part === topicParts[index])
}
