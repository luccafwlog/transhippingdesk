import { describe, expect, it } from 'vitest'
import { computeContainerCost, computeOperationTotals, type CostContainer, type CostDepot, type PricedService } from '../vaziosCusto'

const depot: CostDepot = { id: 'd1', free_time_days: 2 }
const services: PricedService[] = [
  { id: 's1', depot_id: 'd1', name: 'Handling', calc_type: 'fixo_por_container', rate_brl: 100, subject_to_overtime: true, active: true, valid_from: '2026-01-01', valid_to: null },
  { id: 's2', depot_id: 'd1', name: 'Transporte', calc_type: 'fixo_por_container', rate_brl: 50, subject_to_overtime: false, active: true, valid_from: '2026-01-01', valid_to: null },
  { id: 's3', depot_id: 'd1', name: 'Storage', calc_type: 'storage_por_dias', rate_brl: 10, subject_to_overtime: false, active: true, valid_from: '2026-01-01', valid_to: null },
  { id: 's4', depot_id: 'd1', name: 'Reorganização', calc_type: 'quantidade', rate_brl: 30, subject_to_overtime: false, active: true, valid_from: '2026-01-01', valid_to: null },
]
const on = '2026-01-10'

describe('computeContainerCost', () => {
  it('soma fixos, storage além do free time e overtime dos serviços marcados', () => {
    const container: CostContainer = { container_number: 'ABCD1234567', depot_id: 'd1', hand_in_date: '2026-01-01', hand_out_date: '2026-01-06', overtime_pct: 10 }
    const cost = computeContainerCost(container, depot, services, on)
    expect(cost.fixed).toBe(150); expect(cost.storage).toBe(30); expect(cost.overtime).toBe(10); expect(cost.total).toBe(190)
  })
  it('sem depot resolve zero', () => expect(computeContainerCost({ container_number: 'X', depot_id: null }, depot, services, on).total).toBe(0))
  it('storage nunca negativo dentro do free time', () => expect(computeContainerCost({ container_number: 'C', depot_id: 'd1', hand_in_date: '2026-01-01', hand_out_date: '2026-01-02', overtime_pct: 0 }, depot, services, on).storage).toBe(0))

  it('ignora serviço inativo', () => {
    const inativo: PricedService[] = [{ ...services[0], active: false }]
    const cost = computeContainerCost({ container_number: 'C', depot_id: 'd1' }, depot, inativo, on)
    expect(cost.fixed).toBe(0)
  })

  it('ignora serviço fora da vigência', () => {
    const futuro: PricedService[] = [{ ...services[0], valid_from: '2026-02-01' }]
    const encerrado: PricedService[] = [{ ...services[0], valid_to: '2026-01-05' }]
    expect(computeContainerCost({ container_number: 'C', depot_id: 'd1' }, depot, futuro, on).fixed).toBe(0)
    expect(computeContainerCost({ container_number: 'C', depot_id: 'd1' }, depot, encerrado, on).fixed).toBe(0)
  })
})

describe('computeOperationTotals', () => {
  it('inclui quantidade por serviço', () => {
    const container: CostContainer = { container_number: 'C', depot_id: 'd1', hand_in_date: '2026-01-01', hand_out_date: '2026-01-04', overtime_pct: 0 }
    const totals = computeOperationTotals([container], new Map([['d1', depot]]), services, new Map([['s4', 2]]), on)
    expect(totals.qtyTotal).toBe(60); expect(totals.total).toBe(220)
  })

  it('não soma quantidade de serviço fora da vigência', () => {
    const encerrado: PricedService[] = [{ ...services[3], valid_to: '2026-01-05' }]
    const totals = computeOperationTotals([], new Map(), encerrado, new Map([['s4', 2]]), on)
    expect(totals.qtyTotal).toBe(0)
  })
})
