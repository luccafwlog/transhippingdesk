import { describe, expect, it } from 'vitest'
import { computeAdrEscalaPods, getProximaEscala } from '../voyageSummaries'

describe('getProximaEscala com PODs omitidos', () => {
  it('ignora o POD omitido ao escolher a proxima escala', () => {
    const rows = [
      { pod: 'SALVADOR', eta: '2026-07-10', ata: null, omitted: true },
      { pod: 'VITORIA', eta: '2026-07-20', ata: null },
    ]
    expect(getProximaEscala(rows)?.pod).toBe('VITORIA')
  })

  it('retorna null quando o unico POD pendente esta omitido', () => {
    const rows = [{ pod: 'SALVADOR', eta: '2026-07-10', ata: null, omitted: true }]
    expect(getProximaEscala(rows)).toBeNull()
  })
})

describe('computeAdrEscalaPods', () => {
  it('inclui as escalas não omitidas', () => {
    const rows = [{ pod: 'VITORIA', omitted: false }, { pod: 'RIO GRANDE', omitted: false }]
    expect(computeAdrEscalaPods(rows, [])).toEqual([
      { pod: 'VITORIA', omitted: false },
      { pod: 'RIO GRANDE', omitted: false },
    ])
  })

  it('exclui a escala omitida sem ADR fechado', () => {
    const rows = [{ pod: 'SALVADOR', omitted: true }, { pod: 'VITORIA', omitted: false }]
    expect(computeAdrEscalaPods(rows, [])).toEqual([{ pod: 'VITORIA', omitted: false }])
  })

  it('inclui a escala omitida que já tem ADR fechado, marcada como omitida', () => {
    const rows = [{ pod: 'SALVADOR', omitted: true }, { pod: 'VITORIA', omitted: false }]
    expect(computeAdrEscalaPods(rows, ['SALVADOR'])).toEqual([
      { pod: 'SALVADOR', omitted: true },
      { pod: 'VITORIA', omitted: false },
    ])
  })

  it('casa o porto do ADR fechado normalizado (case/espaços)', () => {
    const rows = [{ pod: 'Salvador', omitted: true }]
    expect(computeAdrEscalaPods(rows, [' salvador '])).toEqual([{ pod: 'Salvador', omitted: true }])
  })
})
