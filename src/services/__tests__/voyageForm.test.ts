import { describe, expect, it } from 'vitest'
import { normalizeVoyageFormValues, voyageFormSchema, initialVoyageFormValues } from '../voyageForm'

describe('normalizeVoyageFormValues (US-214 criar/editar viagem)', () => {
  it('faz trim e uppercase de SCAC, navio e numero da viagem', () => {
    const result = normalizeVoyageFormValues({
      ...initialVoyageFormValues,
      carrierName: '  Cosco  ',
      carrierScac: ' cssc ',
      vesselName: ' green santos ',
      vesselImo: ' 9876543 ',
      voyageNumber: ' 14n ',
      status: 'active',
      dischargePortEtas: [],
    })

    expect(result.carrierName).toBe('Cosco')
    expect(result.carrierScac).toBe('CSSC')
    expect(result.vesselName).toBe('GREEN SANTOS')
    expect(result.vesselImo).toBe('9876543')
    expect(result.voyageNumber).toBe('14N')
  })

  it('deduplica PODs por valor maiusculo e descarta linhas totalmente vazias', () => {
    const result = normalizeVoyageFormValues({
      ...initialVoyageFormValues,
      vesselName: 'NAV',
      voyageNumber: '1',
      dischargePortEtas: [
        { pod: 'brvit', eta: '2026-06-01' },
        { pod: 'BRVIT', eta: '2026-06-02' },
        { pod: '', eta: '' },
      ],
    })

    expect(result.dischargePortEtas).toEqual([{ pod: 'BRVIT', eta: '2026-06-02' }])
  })
})

describe('voyageFormSchema (US-214 validacao)', () => {
  it('rejeita navio/viagem ausentes', () => {
    const parsed = voyageFormSchema.safeParse({
      carrierName: 'Cosco',
      carrierScac: 'CSSC',
      vesselName: '',
      vesselImo: '',
      voyageNumber: '',
      status: 'active',
      dischargePortEtas: [],
    })
    expect(parsed.success).toBe(false)
  })

  it('aceita um formulario valido', () => {
    const parsed = voyageFormSchema.safeParse({
      carrierName: 'Cosco',
      carrierScac: 'CSSC',
      vesselName: 'GREEN SANTOS',
      vesselImo: '9876543',
      voyageNumber: '14N',
      status: 'completed',
      dischargePortEtas: [{ pod: 'BRVIT', eta: '2026-06-01' }],
    })
    expect(parsed.success).toBe(true)
  })
})
