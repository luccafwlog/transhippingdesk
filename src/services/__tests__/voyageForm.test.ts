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

  it('normaliza o 1º porto brasileiro indicado e seu ETA', () => {
    const result = normalizeVoyageFormValues({
      ...initialVoyageFormValues,
      vesselName: 'NAV',
      voyageNumber: '1',
      indicatedFirstBrazilianPort: '  brssz  ',
      indicatedFirstBrazilianEta: ' 2026-07-01 ',
      dischargePortEtas: [],
    })

    expect(result.indicatedFirstBrazilianPort).toBe('BRSSZ')
    expect(result.indicatedFirstBrazilianEta).toBe('2026-07-01')
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
      loadPortEtds: [],
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
      loadPortEtds: [],
      dischargePortEtas: [{ pod: 'BRVIT', eta: '2026-06-01' }],
    })
    expect(parsed.success).toBe(true)
  })

  it('valida regras de 1º porto brasileiro indicado', () => {
    // 1. Porto sem ETA
    expect(
      voyageFormSchema.safeParse({
        ...initialVoyageFormValues,
        vesselName: 'NAV',
        voyageNumber: '1',
        indicatedFirstBrazilianPort: 'BRSSZ',
        dischargePortEtas: [{ pod: 'BRVIX', eta: '2026-08-01' }],
      }).success,
    ).toBe(false)

    // 2. ETA sem Porto
    expect(
      voyageFormSchema.safeParse({
        ...initialVoyageFormValues,
        vesselName: 'NAV',
        voyageNumber: '1',
        indicatedFirstBrazilianEta: '2026-07-01',
        dischargePortEtas: [{ pod: 'BRVIX', eta: '2026-08-01' }],
      }).success,
    ).toBe(false)

    // 3. Sem PODs na viagem
    expect(
      voyageFormSchema.safeParse({
        ...initialVoyageFormValues,
        vesselName: 'NAV',
        voyageNumber: '1',
        indicatedFirstBrazilianPort: 'BRSSZ',
        indicatedFirstBrazilianEta: '2026-07-01',
        dischargePortEtas: [],
      }).success,
    ).toBe(false)

    // 4. ETA indicado posterior ou igual ao menor ETA próprio
    expect(
      voyageFormSchema.safeParse({
        ...initialVoyageFormValues,
        vesselName: 'NAV',
        voyageNumber: '1',
        indicatedFirstBrazilianPort: 'BRSSZ',
        indicatedFirstBrazilianEta: '2026-08-05',
        dischargePortEtas: [{ pod: 'BRVIX', eta: '2026-08-01' }],
      }).success,
    ).toBe(false)

    // 5. ETA indicado estritamente anterior ao menor ETA próprio
    expect(
      voyageFormSchema.safeParse({
        ...initialVoyageFormValues,
        vesselName: 'NAV',
        voyageNumber: '1',
        indicatedFirstBrazilianPort: 'BRSSZ',
        indicatedFirstBrazilianEta: '2026-07-25',
        dischargePortEtas: [{ pod: 'BRVIX', eta: '2026-08-01' }],
      }).success,
    ).toBe(true)
  })
})
