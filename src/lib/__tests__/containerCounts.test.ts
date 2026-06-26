import { describe, expect, it } from 'vitest'

import {
  countDistinctContainerNumbers,
  countDistinctContainerNumbersBy,
  countDistinctContainersAcrossGroups,
} from '../containerCounts'

describe('countDistinctContainerNumbers', () => {
  it('conta números distintos normalizando caixa e espaços', () => {
    expect(
      countDistinctContainerNumbers([
        { container_number: 'abcd1234567' },
        { container_number: ' ABCD1234567 ' },
        { container_number: 'EFGH7654321' },
      ]),
    ).toBe(2)
  })

  it('ignora vazios, nulos e undefined; trata null/undefined da lista', () => {
    expect(countDistinctContainerNumbers([{ container_number: '' }, { container_number: null }])).toBe(0)
    expect(countDistinctContainerNumbers(null)).toBe(0)
    expect(countDistinctContainerNumbers(undefined)).toBe(0)
  })
})

describe('countDistinctContainersAcrossGroups', () => {
  it('deduplica o mesmo container que aparece em grupos diferentes', () => {
    const groups = [
      { items: [{ container_number: 'AAAA1111111' }] },
      { items: [{ container_number: 'aaaa1111111' }, { container_number: 'BBBB2222222' }] },
    ]
    expect(countDistinctContainersAcrossGroups(groups, (g) => g.items)).toBe(2)
  })
})

describe('countDistinctContainerNumbersBy', () => {
  it('aplica o predicado antes de contar distintos', () => {
    const containers = [
      { container_number: 'AAAA1111111', full: true },
      { container_number: 'BBBB2222222', full: false },
    ]
    expect(countDistinctContainerNumbersBy(containers, (c) => c.full)).toBe(1)
  })
})
