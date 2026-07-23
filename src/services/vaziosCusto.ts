import type { DepotService, DepotTariff } from './depots'

export type CostContainer = {
  container_number: string
  depot_id?: string | null
  hand_in_date?: string | null
  hand_out_date?: string | null
  overtime_handling_pct?: number | null
  overtime_transport_pct?: number | null
  visual_check?: boolean | null
}

export type ContainerCost = {
  container_number: string
  handling: number
  storage: number
  transporte: number
  overtime: number
  services: number
  total: number
  breakdown: Array<{ label: string; amount: number }>
}

const daysBetween = (start: string | null | undefined, end: string | null | undefined) => {
  if (!start || !end) return 0
  const startMs = Date.parse(start); const endMs = Date.parse(end)
  return Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, Math.round((endMs - startMs) / 86_400_000)) : 0
}

export function computeContainerCost(container: CostContainer, tariff: DepotTariff | null, services: DepotService[] = []): ContainerCost {
  if (!tariff || !container.depot_id) return { container_number: container.container_number, handling: 0, storage: 0, transporte: 0, overtime: 0, services: 0, total: 0, breakdown: [] }
  const handling = Number(tariff.handling_in_brl) + Number(tariff.handling_out_brl)
  const transporte = Number(tariff.transporte_brl)
  const storageDays = Math.max(0, daysBetween(container.hand_in_date, container.hand_out_date) - Number(tariff.free_time_days))
  const storage = storageDays * Number(tariff.storage_day_brl)
  const overtime = handling * (Number(container.overtime_handling_pct ?? 0) / 100) + transporte * (Number(container.overtime_transport_pct ?? 0) / 100)
  const depotServices = services.filter((service) => service.depot_id === container.depot_id)
  const serviceTotal = container.visual_check ? depotServices.filter((service) => service.charge_basis === 'per_container_flag' && service.name === 'visual_check').reduce((sum, service) => sum + Number(service.rate_brl), 0) : 0
  const breakdown = [
    { label: 'Handling', amount: handling }, { label: 'Storage', amount: storage }, { label: 'Transporte', amount: transporte }, { label: 'Overtime', amount: overtime }, { label: 'Serviços', amount: serviceTotal },
  ].filter((line) => line.amount !== 0)
  return { container_number: container.container_number, handling, storage, transporte, overtime, services: serviceTotal, total: handling + storage + transporte + overtime + serviceTotal, breakdown }
}

export function computeOperationTotals(containers: CostContainer[], tariffs: Map<string, DepotTariff | null>, services: DepotService[], operations: { bundle: number; desova: number }) {
  const rows = containers.map((container) => computeContainerCost(container, container.depot_id ? tariffs.get(container.depot_id) ?? null : null, services))
  // ponytail: bundle/desova são quantidades por operação (não por container); com mais de um depot na
  // operação a tarifa é ambígua — usamos a primeira encontrada. Upgrade: pedir o depot da operação na UI
  // (Task 9) e filtrar por ele, como já é feito por container em computeContainerCost.
  const bundleRate = services.find((service) => service.name === 'bundle' && service.charge_basis === 'per_operation_qty')?.rate_brl ?? 0
  const desovaRate = services.find((service) => service.name === 'desova' && service.charge_basis === 'per_operation_qty')?.rate_brl ?? 0
  const bundle = operations.bundle * Number(bundleRate); const desova = operations.desova * Number(desovaRate)
  return { rows, bundle, desova, total: rows.reduce((sum, row) => sum + row.total, 0) + bundle + desova }
}
