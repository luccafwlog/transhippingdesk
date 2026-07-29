import { describe, expect, it } from 'vitest'
import { computeStorageTotals } from '../vaziosExportOperations'

describe('computeStorageTotals', () => {
  it('soma containers e dias derivados de hand-in/hand-out', () => {
    expect(computeStorageTotals([{ local_id: 'd1', condition: 'vazio', hand_in_date: '2026-07-01', hand_out_date: '2026-07-05' }, { local_id: 'd1', condition: 'vazio', hand_in_date: '2026-07-02', hand_out_date: '2026-07-02' }, { local_id: 'd1', condition: 'vazio', hand_in_date: null, hand_out_date: null }], [{ id: 'd1', tipo: 'depot', free_time_vazio_days: 0, free_time_material_days: 0 }])).toEqual({ containers: 2, days: 4 })
  })
  it('ignora datas inválidas ou negativas', () => {
    expect(computeStorageTotals([{ local_id: 'd1', condition: 'vazio', hand_in_date: 'x', hand_out_date: '2026-07-05' }, { local_id: 'd1', condition: 'vazio', hand_in_date: '2026-07-05', hand_out_date: '2026-07-01' }, { local_id: 'd1', condition: 'vazio', hand_in_date: '2026-07-01', hand_out_date: '2026-07-03' }], [{ id: 'd1', tipo: 'depot' }])).toEqual({ containers: 1, days: 2 })
  })
})
