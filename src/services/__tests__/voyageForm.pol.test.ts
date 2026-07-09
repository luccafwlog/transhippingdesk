import { describe, expect, it } from 'vitest'
import { initialVoyageFormValues, normalizeVoyageFormValues } from '../voyageForm'

describe('voyageForm - portos de carregamento (POL)', () => {
  it('normaliza e descarta POLs vazios', () => {
    const out = normalizeVoyageFormValues({
      ...initialVoyageFormValues,
      vesselName: 'NAVIO',
      voyageNumber: '1',
      carrierName: 'Cosco',
      loadPortEtds: [
        { pol: ' cntao ', etd: '2026-01-04' },
        { pol: '', etd: '' },
      ],
    })

    expect(out.loadPortEtds).toEqual([{ pol: 'CNTAO', etd: '2026-01-04' }])
  })
})
