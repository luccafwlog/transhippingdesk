import { describe, expect, it } from 'vitest'
import { normalizePortCode } from '../portCode'

describe('normalizePortCode - portos-vitrine do servico CSSC', () => {
  const cases: Array<[string, string]> = [
    ['QINGDAO', 'CNTAO'],
    ['SHANGHAI', 'CNSHA'],
    ['NINGBO', 'CNNGB'],
    ['NANSHA', 'CNNSA'],
    ['PECEM', 'BRPEC'],
    ['PECÉM', 'BRPEC'],
  ]

  it.each(cases)('mapeia %s -> %s', (name, code) => {
    expect(normalizePortCode(name)).toBe(code)
  })

  it('mantem os codigos ja suportados', () => {
    expect(normalizePortCode('SALVADOR')).toBe('BRSSA')
    expect(normalizePortCode('TAICANG')).toBe('CNTAC')
    expect(normalizePortCode('CNSHA')).toBe('CNSHA')
  })
})
