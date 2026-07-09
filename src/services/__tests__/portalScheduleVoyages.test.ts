import { describe, expect, it } from 'vitest'
import { projectPortalScheduleRows, type PortalScheduleRpcRow } from '../portalScheduleVoyages'

describe('projectPortalScheduleRows', () => {
  const rows: PortalScheduleRpcRow[] = [
    { voyage_id: 2, vessel_name: 'B', voyage: '2', imo_number: null, port_code: 'BRSSA', kind: 'pod', date_value: '2026-02-01' },
    { voyage_id: 1, vessel_name: 'A', voyage: '1', imo_number: '900', port_code: 'CNTAO', kind: 'pol', date_value: '2026-01-04' },
    { voyage_id: 1, vessel_name: 'A', voyage: '1', imo_number: '900', port_code: 'BRSSA', kind: 'pod', date_value: '2026-01-22' },
  ]

  it('agrupa por viagem, indexa data por lane e ordena por ETA mais proxima', () => {
    const out = projectPortalScheduleRows(rows)
    expect(out.map((voyage) => voyage.voyageId)).toEqual([1, 2])
    expect(out[0].datesByLabel.QINGDAO).toBe('2026-01-04')
    expect(out[0].datesByLabel.SALVADOR).toBe('2026-01-22')
    expect(out[0].datesByLabel.VITÓRIA).toBeUndefined()
  })
})
