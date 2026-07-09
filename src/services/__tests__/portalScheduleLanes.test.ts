import { describe, expect, it } from 'vitest'
import { PORTAL_SCHEDULE_LANES, portalLaneCode } from '../portalScheduleLanes'

describe('portas-vitrine do Portal', () => {
  it('lista os 8 portos do servico na ordem das colunas', () => {
    expect(PORTAL_SCHEDULE_LANES.map((lane) => lane.label)).toEqual([
      'QINGDAO',
      'SHANGHAI',
      'TAICANG',
      'NINGBO',
      'NANSHA',
      'SALVADOR',
      'VITÓRIA',
      'PECÉM',
    ])
  })

  it('classifica origem como POL e destino como POD', () => {
    const byLabel = Object.fromEntries(PORTAL_SCHEDULE_LANES.map((lane) => [lane.label, lane.kind]))
    expect(byLabel.QINGDAO).toBe('pol')
    expect(byLabel.SALVADOR).toBe('pod')
  })

  it('deriva o code canonico via normalizePortCode', () => {
    expect(portalLaneCode(PORTAL_SCHEDULE_LANES[0])).toBe('CNTAO')
    expect(portalLaneCode(PORTAL_SCHEDULE_LANES[5])).toBe('BRSSA')
  })
})
