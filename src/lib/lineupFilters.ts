import type { LineUpRow } from '../services/lineup'

export type LineUpPeriodoFilter = 'all' | 'custom'
export type LineUpCeFilter = 'all' | 'waiting' | 'received' | 'launching' | 'approving' | 'approved'
export type LineUpStatusFilter = 'all' | 'active' | 'completed' | 'cancelled'

export type LineUpFilters = {
  vessels: string[]
  voyages: string[]
  status: LineUpStatusFilter
  periodo: LineUpPeriodoFilter
  dataInicio: string
  dataFim: string
  vehicles: boolean
  bb: boolean
  ces: LineUpCeFilter
  linked: boolean
  mty: boolean
  rtw: boolean
}

export function filterLineUpRows(rows: LineUpRow[], filters: LineUpFilters): LineUpRow[] {
  const voyagesWithMty = new Set(rows.filter((row) => row.mty > 0).map((row) => row.voyageId))

  return rows.filter((row) => {
    // Exportações representam uma programação distinta e não somem com filtros operacionais do Line Up.
    if (row.rowType === 'export') return true
    if (filters.status !== 'all' && row.voyageStatus !== filters.status) return false
    if (filters.vessels.length > 0 && !filters.vessels.includes(row.vesselName)) return false
    if (filters.voyages.length > 0 && !filters.voyages.includes(row.voyageNumber)) return false
    if (filters.periodo === 'custom' && !isWithinPeriod(row.eta, filters.dataInicio, filters.dataFim)) return false
    if (filters.vehicles && row.vin <= 0) return false
    if (filters.bb && row.bbTotal <= 0) return false
    if (filters.ces !== 'all' && ceFilterStatus(row.ceStatus) !== filters.ces) return false
    if (filters.linked && !row.linked) return false
    if (filters.mty && !voyagesWithMty.has(row.voyageId)) return false
    if (filters.rtw && !(row.rtw && row.rtw > 0)) return false
    return true
  })
}

function isWithinPeriod(eta: string | null, dataInicio: string, dataFim: string) {
  if (!dataInicio && !dataFim) return true
  if (!eta) return false
  const date = eta.slice(0, 10)
  if (dataInicio && date < dataInicio) return false
  if (dataFim && date > dataFim) return false
  return true
}

function ceFilterStatus(status: LineUpRow['ceStatus']): LineUpCeFilter {
  if (status === 'waiting' || status === 'missing') return 'waiting'
  if (status === 'partial') return 'launching'
  return status
}

export function countActiveLineUpFilters(filters: LineUpFilters): number {
  let count = 0
  if (filters.vessels.length > 0) count += 1
  if (filters.voyages.length > 0) count += 1
  if (filters.status !== 'active') count += 1
  if (filters.periodo !== 'all') count += 1
  if (filters.vehicles) count += 1
  if (filters.bb) count += 1
  if (filters.ces !== 'all') count += 1
  if (filters.linked) count += 1
  if (filters.mty) count += 1
  if (filters.rtw) count += 1
  return count
}

export function emptyLineUpFilters(): LineUpFilters {
  return {
    vessels: [], voyages: [], status: 'active', periodo: 'all', dataInicio: '', dataFim: '',
    vehicles: false, bb: false, ces: 'all', linked: false, mty: false, rtw: false,
  }
}
