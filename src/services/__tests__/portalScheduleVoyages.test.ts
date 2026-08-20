import { describe, expect, it } from 'vitest'
import { projectPortalScheduleRows, type PortalScheduleRpcRow } from '../portalScheduleVoyages'

describe('projectPortalScheduleRows', () => {
  const rows: PortalScheduleRpcRow[] = [
    { voyage_id: 2, vessel_name: 'B', voyage: '2', imo_number: null, port_code: 'BRSSA', kind: 'pod', date_value: '2026-02-01' },
    { voyage_id: 1, vessel_name: 'A', voyage: '1', imo_number: '900', port_code: 'CNTAO', kind: 'pol', date_value: '2026-01-04', actual_value: '2026-01-06' },
    { voyage_id: 1, vessel_name: 'A', voyage: '1', imo_number: '900', port_code: 'BRSSA', kind: 'pod', date_value: '2026-01-22', actual_value: '2026-01-23' },
  ]

  it('agrupa por viagem, indexa data por lane e ordena por ETA mais proxima', () => {
    const out = projectPortalScheduleRows(rows)
    expect(out.map((voyage) => voyage.voyageId)).toEqual([1, 2])
    expect(out[0].datesByLabel.QINGDAO).toBe('2026-01-06')
    expect(out[0].datesByLabel.SALVADOR).toBe('2026-01-23')
    expect(out[0].forecastDatesByLabel?.QINGDAO).toBe('2026-01-04')
    expect(out[0].actualDatesByLabel?.QINGDAO).toBe('2026-01-06')
    expect(out[0].datesByLabel.QINGDAO).toBe('2026-01-06')
    expect(out[0].datesByLabel.VITÓRIA).toBeUndefined()
  })

  it('carrega a marca de omissão sem transformar a célula sem data em X', () => {
    const out = projectPortalScheduleRows([
      { voyage_id: 3, vessel_name: 'C', voyage: '3', imo_number: null, port_code: 'BRVIX', kind: 'pod', date_value: null, omitted: true },
    ])
    expect(out[0].omittedByLabel?.['VITÓRIA']).toBe(true)
    expect(out[0].datesByLabel['VITÓRIA']).toBeUndefined()
  })
})
