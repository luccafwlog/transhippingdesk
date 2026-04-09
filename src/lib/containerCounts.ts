type ContainerLike = {
  container_number?: string | null
}

export function normalizeContainerNumber(value: string | null | undefined) {
  return String(value ?? '').trim().toUpperCase()
}

export function getDistinctContainerNumbers<T extends ContainerLike>(containers: T[] | null | undefined) {
  const numbers = new Set<string>()

  for (const container of containers ?? []) {
    const normalized = normalizeContainerNumber(container.container_number)
    if (normalized) {
      numbers.add(normalized)
    }
  }

  return numbers
}

export function countDistinctContainerNumbers<T extends ContainerLike>(containers: T[] | null | undefined) {
  return getDistinctContainerNumbers(containers).size
}

export function countDistinctContainersAcrossGroups<TGroup, TContainer extends ContainerLike>(
  groups: TGroup[] | null | undefined,
  getContainers: (group: TGroup) => TContainer[] | null | undefined,
) {
  const numbers = new Set<string>()

  for (const group of groups ?? []) {
    for (const container of getContainers(group) ?? []) {
      const normalized = normalizeContainerNumber(container.container_number)
      if (normalized) {
        numbers.add(normalized)
      }
    }
  }

  return numbers.size
}

export function countDistinctContainerNumbersBy<T extends ContainerLike>(
  containers: T[] | null | undefined,
  predicate: (container: T) => boolean,
) {
  return countDistinctContainerNumbers((containers ?? []).filter(predicate))
}
