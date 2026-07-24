export type ServiceCalcType = 'fixo_por_container' | 'storage_por_dias' | 'quantidade'

export type PricedService = {
  id: string
  depot_id: string
  name: string
  calc_type?: string
  rate_brl: number
  subject_to_overtime?: boolean
  active?: boolean
  valid_from?: string
  valid_to?: string | null
}

export type CostDepot = { id: string; free_time_days: number }

export type CostContainer = {
  container_number: string
  depot_id?: string | null
  hand_in_date?: string | null
  hand_out_date?: string | null
  overtime_pct?: number | null
}

export type ContainerCost = {
  container_number: string
  fixed: number
  storage: number
  overtime: number
  total: number
  breakdown: Array<{ label: string; amount: number }>
}

const today = () => new Date().toISOString().slice(0, 10)

const daysBetween = (start: string | null | undefined, end: string | null | undefined) => {
  if (!start || !end) return 0
  const startMs = Date.parse(start); const endMs = Date.parse(end)
  return Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, Math.round((endMs - startMs) / 86_400_000)) : 0
}

export function isVigente(service: PricedService, on = today()): boolean {
  if (service.active === false) return false
  if (service.valid_from && service.valid_from > on) return false
  if (service.valid_to && service.valid_to < on) return false
  return true
}

export function computeContainerCost(container: CostContainer, depot: CostDepot | null, services: PricedService[] = [], on = today()): ContainerCost {
  const zero: ContainerCost = { container_number: container.container_number, fixed: 0, storage: 0, overtime: 0, total: 0, breakdown: [] }
  if (!depot || !container.depot_id) return zero
  const own = services.filter((service) => service.depot_id === container.depot_id && isVigente(service, on))
  const fixed = own.filter((s) => s.calc_type === 'fixo_por_container').reduce((sum, s) => sum + Number(s.rate_brl), 0)
  const storageRate = own.filter((s) => s.calc_type === 'storage_por_dias').reduce((sum, s) => sum + Number(s.rate_brl), 0)
  const storageDays = Math.max(0, daysBetween(container.hand_in_date, container.hand_out_date) - Number(depot.free_time_days))
  const storage = storageDays * storageRate
  const overtimeBase = own.filter((s) => s.calc_type === 'fixo_por_container' && s.subject_to_overtime).reduce((sum, s) => sum + Number(s.rate_brl), 0)
  const overtime = overtimeBase * (Number(container.overtime_pct ?? 0) / 100)
  const breakdown = [
    { label: 'Fixos por container', amount: fixed },
    { label: 'Storage', amount: storage },
    { label: 'Overtime', amount: overtime },
  ].filter((line) => line.amount !== 0)
  return { container_number: container.container_number, fixed, storage, overtime, total: fixed + storage + overtime, breakdown }
}

export function computeOperationTotals(
  containers: CostContainer[],
  depots: Map<string, CostDepot | null>,
  services: PricedService[],
  qtyByServiceId: Map<string, number>,
  on = today(),
) {
  const rows = containers.map((container) => computeContainerCost(container, container.depot_id ? depots.get(container.depot_id) ?? null : null, services, on))
  const qtyTotal = services
    .filter((s) => s.calc_type === 'quantidade' && isVigente(s, on))
    .reduce((sum, s) => sum + (qtyByServiceId.get(s.id) ?? 0) * Number(s.rate_brl), 0)
  return { rows, qtyTotal, total: rows.reduce((sum, row) => sum + row.total, 0) + qtyTotal }
}
