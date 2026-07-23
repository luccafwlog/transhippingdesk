import { describe, expect, it } from 'vitest'
import { computeContainerCost, computeOperationTotals } from '../vaziosCusto'

const tariff = { id: 't', depot_id: 'd', handling_in_brl: 10, handling_out_brl: 20, transporte_brl: 5, storage_day_brl: 2, free_time_days: 3, valid_from: '2026-01-01', valid_to: null, active: true, created_at: '2026-01-01' }
const services = [
  { id: 'v', depot_id: 'd', name: 'visual_check', charge_basis: 'per_container_flag' as const, rate_brl: 7, active: true, valid_from: '2026-01-01', valid_to: null, created_at: '2026-01-01' },
  { id: 'b', depot_id: 'd', name: 'bundle', charge_basis: 'per_operation_qty' as const, rate_brl: 11, active: true, valid_from: '2026-01-01', valid_to: null, created_at: '2026-01-01' },
]

describe('custo de VAZIOS EXP', () => {
  it('zera Embarque Direto e respeita free time', () => {
    expect(computeContainerCost({ container_number: 'ABCD1234567', depot_id: null }, tariff).total).toBe(0)
    expect(computeContainerCost({ container_number: 'ABCD1234567', depot_id: 'd', hand_in_date: '2026-07-01', hand_out_date: '2026-07-03' }, tariff).storage).toBe(0)
  })
  it('calcula overtime como acrescimo e soma servicos por operacao', () => {
    const row = computeContainerCost({ container_number: 'ABCD1234567', depot_id: 'd', hand_in_date: '2026-07-01', hand_out_date: '2026-07-10', overtime_handling_pct: 10, overtime_transport_pct: 20, visual_check: true }, tariff, services)
    expect(row.overtime).toBe(4)
    const total = computeOperationTotals([{ container_number: 'ABCD1234567', depot_id: 'd' }], new Map([['d', tariff]]), services, { bundle: 2, desova: 0 })
    expect(total.bundle).toBe(22)
  })
  it('nao soma visual check de outro depot na mesma operacao', () => {
    const otherDepotServices = [
      { id: 'v2', depot_id: 'other', name: 'visual_check', charge_basis: 'per_container_flag' as const, rate_brl: 999, active: true, valid_from: '2026-01-01', valid_to: null, created_at: '2026-01-01' },
    ]
    const row = computeContainerCost(
      { container_number: 'ABCD1234567', depot_id: 'd', visual_check: true },
      tariff,
      [...services, ...otherDepotServices],
    )
    expect(row.services).toBe(7)
  })
})
