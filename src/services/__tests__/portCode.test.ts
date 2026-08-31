import { describe, expect, it } from 'vitest'
import { normalizePortCode, portCodeVariants } from '../portCode'

describe('normalizePortCode - portos-vitrine do servico CSSC', () => {
  const cases: Array<[string, string]> = [
    ['QINGDAO', 'CNTAO'],
    ['QINDGAO', 'CNTAO'],
    ['qindgao', 'CNTAO'],
    ['SHANGHAI', 'CNSHA'],
    ['NINGBO', 'CNNGB'],
    ['NANSHA', 'CNNSA'],
    ['PECEM', 'BRPEC'],
    ['PECÉM', 'BRPEC'],
    ['CNTAG', 'CNTAC'],
    ['TAICANG', 'CNTAC'],
    ['TAIKANG', 'CNTAC'],
    ['CNTAI', 'CNTAC'],
    ['CNNBO', 'CNNGB'],
    ['ZOS', 'CNNGB'],
    ['CNSHG', 'CNSHA'],
    ['CNQDG', 'CNTAO'],
    ['SANTOS', 'BRSSZ'],
    ['PARANAGUÁ', 'BRPNG'],
    ['ITAJAÍ', 'BRITJ'],
    ['NAVEGANTES', 'BRITJ'],
    ['VITÓRIA', 'BRVIX'],
  ]

  it.each(cases)('mapeia %s -> %s', (name, code) => {
    expect(normalizePortCode(name)).toBe(code)
  })

  it('mantem os codigos ja suportados', () => {
    expect(normalizePortCode('SALVADOR')).toBe('BRSSA')
    expect(normalizePortCode('TAICANG')).toBe('CNTAC')
    expect(normalizePortCode('CNTAG')).toBe('CNTAC')
    expect(normalizePortCode('CNSHA')).toBe('CNSHA')
  })

  it('retorna aliases persistidos para consultas sem duplicar o porto', () => {
    expect(portCodeVariants('BRVIX')).toEqual(expect.arrayContaining(['BRVIX', 'VITORIA', 'BRVIT']))
    expect(portCodeVariants('CNTAO')).toEqual(expect.arrayContaining(['CNTAO', 'QINGDAO', 'QINDGAO']))
    expect(portCodeVariants('PECEM')).toEqual(expect.arrayContaining(['BRPEC', 'PECEM']))
    expect(portCodeVariants('CNTAC')).toEqual(expect.arrayContaining(['CNTAC', 'TAICANG', 'CNTAG']))
    expect(portCodeVariants('CNNGB')).toEqual(expect.arrayContaining(['CNNGB', 'ZOS']))
  })
})
