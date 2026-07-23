import { describe, expect, it } from 'vitest'
import { computeStorageTotals } from '../vaziosExportOperations'

describe('computeStorageTotals', () => {
  it('soma containers e dias derivados de hand-in/hand-out', () => {
    expect(computeStorageTotals([{ hand_in_date: '2026-07-01', hand_out_date: '2026-07-05' }, { hand_in_date: '2026-07-02', hand_out_date: '2026-07-02' }, { hand_in_date: null, hand_out_date: null }])).toEqual({ containers: 2, days: 4 })
  })
  it('ignora datas inválidas ou negativas', () => {
    expect(computeStorageTotals([{ hand_in_date: 'x', hand_out_date: '2026-07-05' }, { hand_in_date: '2026-07-05', hand_out_date: '2026-07-01' }, { hand_in_date: '2026-07-01', hand_out_date: '2026-07-03' }])).toEqual({ containers: 1, days: 2 })
  })
})
