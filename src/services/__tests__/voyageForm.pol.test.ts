import { describe, expect, it } from 'vitest'
import { initialVoyageFormValues, normalizeVoyageFormValues } from '../voyageForm'

describe('voyageForm sem datas de POL/POD', () => {
  it('não reinjeta listas de datas documentais no formulário', () => {
    const out = normalizeVoyageFormValues({ ...initialVoyageFormValues, vesselName: 'NAVIO', voyageNumber: '1' })
    expect(out).not.toHaveProperty('loadPortEtds')
    expect(out).not.toHaveProperty('dischargePortEtas')
  })
})
