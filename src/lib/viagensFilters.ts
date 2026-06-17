import type { VoyageRailItem } from '../pages/viagensHelpers'

export type StatusFilter = 'all' | 'active' | 'completed'
export type ConciliacaoFilter = 'all' | 'conciliada' | 'pendente'
export type PeriodoFilter = 'all' | 'hoje' | '7d' | '30d' | 'custom'

export type VoyageFilters = {
  search: string
  status: StatusFilter
  conciliacao: ConciliacaoFilter
  periodo: PeriodoFilter
  /** Usados apenas quando periodo === 'custom'. ISO (yyyy-mm-dd) ou ''. */
  dataInicio?: string
  dataFim?: string
}

function nextEscalaSortKey(item: VoyageRailItem) {
  return item.proximaEscala?.eta ?? '￿'
}

function periodoMinEta(periodo: 'hoje' | '7d' | '30d'): string {
  const now = new Date()
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (periodo === 'hoje') return base.toISOString().slice(0, 10)
  const days = periodo === '7d' ? 7 : 30
  base.setDate(base.getDate() + days)
  return base.toISOString().slice(0, 10)
}

export function filterVoyageRailItems(
  items: VoyageRailItem[],
  filters: VoyageFilters,
): VoyageRailItem[] {
  const term = filters.search.trim().toUpperCase()

  return items
    .filter((item) => {
      if (filters.status !== 'all' && item.status !== filters.status) return false
      if (filters.conciliacao === 'conciliada' && item.estado !== 'conciliado') return false
      if (filters.conciliacao === 'pendente' && item.estado === 'conciliado') return false
      if (filters.periodo === 'custom') {
        const ini = filters.dataInicio?.trim() ?? ''
        const fim = filters.dataFim?.trim() ?? ''
        if (ini || fim) {
          const eta = item.proximaEscala?.eta
          if (!eta) return false
          if (ini && eta < ini) return false
          if (fim && eta > fim) return false
        }
      } else if (filters.periodo !== 'all') {
        const minEta = periodoMinEta(filters.periodo)
        const eta = item.proximaEscala?.eta
        if (!eta || eta < minEta) return false
      }
      if (term) {
        const haystack = [
          item.vesselName,
          item.voyageNumber,
          item.carrierName,
          ...item.originPorts,
          ...item.destinationPorts,
        ].join(' ').toUpperCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
    .sort((left, right) => {
      const byEscala = nextEscalaSortKey(left).localeCompare(nextEscalaSortKey(right))
      if (byEscala !== 0) return byEscala
      return `${left.vesselName} ${left.voyageNumber}`.localeCompare(
        `${right.vesselName} ${right.voyageNumber}`,
        'pt-BR',
      )
    })
}

export function countActiveFilters(filters: VoyageFilters): number {
  let n = 0
  if (filters.search.trim()) n += 1
  if (filters.status !== 'all') n += 1
  if (filters.conciliacao !== 'all') n += 1
  if (filters.periodo !== 'all') n += 1
  return n
}

export function emptyFilters(): VoyageFilters {
  return { search: '', status: 'all', conciliacao: 'all', periodo: 'all', dataInicio: '', dataFim: '' }
}
