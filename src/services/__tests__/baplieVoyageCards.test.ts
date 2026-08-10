import { describe, expect, it } from 'vitest'

import { buildBaplieVoyageCards } from '../baplieVoyageCards'

describe('buildBaplieVoyageCards', () => {
  it('lista viagens sem Baplie e ordena todas pela próxima escala', () => {
    const cards = buildBaplieVoyageCards([
      {
        id: 2,
        voyageNumber: '2026B',
        vesselName: 'Ocean Two',
        carrierName: 'Carrier',
        hasBaplie: false,
        escalas: [{ port: 'BRVIX', eta: '2026-10-04', etd: null, atd: null }],
      },
      {
        id: 1,
        voyageNumber: '2026A',
        vesselName: 'Ocean One',
        carrierName: 'Carrier',
        hasBaplie: true,
        escalas: [{ port: 'BRSSA', eta: '2026-10-01', etd: null, atd: null }],
      },
    ])

    expect(cards.map((card) => card.id)).toEqual([1, 2])
    expect(cards[1].hasBaplie).toBe(false)
  })
})
