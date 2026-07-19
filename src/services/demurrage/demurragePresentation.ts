import type { DemurrageContainerListItem } from '../../types/database'
import { formatBRL, formatUSD } from '../../lib/utils'
import { calculateDemurrage } from './demurrageRates'

export function fmtUSD(value: number | null | undefined) {
  if (value == null) return '---'
  return formatUSD(value)
}

// Ultimo dia util (hoje se for dia de semana; senao a sexta anterior). O recalculo
// do BCB so roda em dias uteis. ponytail: feriados nacionais nao sao considerados
// (banner pode soar falso-positivo em feriado) - operador pode ignorar/informar manual.
export function lastBusinessDayISO(): string {
  const date = new Date()
  if (date.getDay() === 0) date.setDate(date.getDate() - 2)
  else if (date.getDay() === 6) date.setDate(date.getDate() - 1)
  return date.toISOString().slice(0, 10)
}

export function fmtBRL(value: number | null | undefined) {
  // ponytail: canonical Intl currency spacing may differ from the former print formatter.
  return value == null ? '---' : formatBRL(value)
}

export function groupByBl(containers: DemurrageContainerListItem[]): Map<string, DemurrageContainerListItem[]> {
  const map = new Map<string, DemurrageContainerListItem[]>()
  for (const container of containers) {
    const blId = container.bl_id ?? 'unknown'
    if (!map.has(blId)) map.set(blId, [])
    map.get(blId)!.push(container)
  }
  return map
}

function containerBlRates(container: DemurrageContainerListItem) {
  return container.bl as {
    free_time_override?: number | null
    demurrage_rate_override_p1_usd?: number | null
    demurrage_rate_override_p2_usd?: number | null
  } | null
}

// Demurrage operacional do container: usa a devolucao quando existe, senao hoje
// (container ainda fora, sobreestadia correndo). Null sem data de descarga.
export function effectiveDemurrage(container: DemurrageContainerListItem) {
  if (!container.discharge_date) return null
  const end = container.return_date ?? new Date().toISOString().slice(0, 10)
  const bl = containerBlRates(container)
  return calculateDemurrage(
    container.type,
    container.discharge_date,
    end,
    bl?.free_time_override,
    bl?.demurrage_rate_override_p1_usd,
    bl?.demurrage_rate_override_p2_usd,
  )
}
