import { describe, expect, it } from 'vitest'
import { computeVoyageStatusFromPods } from '../voyageRouteSchedules'

describe('computeVoyageStatusFromPods', () => {
  it('conclui a viagem quando o unico POD nao-omitido tem ATD', () => {
    expect(
      computeVoyageStatusFromPods([
        { atd: '2026-07-20', omitted: false },
        { atd: null, omitted: true },
      ]),
    ).toBe('completed')
  })

  it('mantem ativa quando um POD nao-omitido ainda nao tem ATD', () => {
    expect(
      computeVoyageStatusFromPods([
        { atd: null, omitted: false },
        { atd: null, omitted: true },
      ]),
    ).toBe('active')
  })
})
