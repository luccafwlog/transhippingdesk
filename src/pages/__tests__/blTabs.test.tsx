import { describe, expect, it } from 'vitest'
import { BL_TABS, isBlTab } from '../BlDetalhe'

describe('BL tabs', () => {
  it('exposes exactly the three tabs', () => {
    expect(BL_TABS.map((t) => t.key)).toEqual(['detalhes', 'faturamento', 'historico'])
  })
  it('guards tab keys', () => {
    expect(isBlTab('detalhes')).toBe(true)
    expect(isBlTab('operacional')).toBe(false)
  })
})
