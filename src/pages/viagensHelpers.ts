// Helpers puros (sem UI/hooks) extraídos de Viagens.tsx para reduzir o monólito
// e permitir teste unitário direto. Comportamento idêntico ao original.
import { countDistinctContainerNumbers } from '../lib/containerCounts'

export function normalizePortName(value: string | null | undefined) {
  return (value ?? '').trim().toUpperCase() || '-'
}

export function formatPortDisplayName(port: string | null | undefined) {
  const normalized = normalizePortName(port)

  const portNames: Record<string, string> = {
    CNNBO: 'NINGBO',
    CNNSA: 'NANSHA',
    CNSHG: 'SHANGHAI',
    CNTAC: 'TAICANG',
    BRVIT: 'VITORIA',
    VIX: 'VITORIA',
  }

  return portNames[normalized] ?? (String(port ?? '').trim() || '-')
}

export function summarizeContainerTypes(
  containers:
    | Array<{
        container_number?: string | null
        type?: string | null
      }>
    | null
    | undefined,
) {
  const groups = new Map<string, Array<{ container_number?: string | null }>>()

  for (const container of containers ?? []) {
    const type = String(container.type ?? '').trim() || 'Não informado'
    const current = groups.get(type)

    if (current) {
      current.push(container)
    } else {
      groups.set(type, [container])
    }
  }

  return Array.from(groups.entries())
    .map(([type, items]) => ({ type, count: countDistinctContainerNumbers(items) }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type, 'pt-BR'))
    .map(({ type, count }) => `${type}: ${count}`)
    .join(' | ')
}

export function summarizeUniqueValues(values: Array<string | null | undefined>) {
  const normalized = Array.from(
    new Set(
      values
        .map((value) => String(value ?? '').trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right, 'pt-BR'))

  return normalized.join(' | ')
}

export function summarizeOccurrences<T>(
  items: T[] | null | undefined,
  getLabel: (item: T) => string | null | undefined,
  fallbackLabel: string,
) {
  const counts = new Map<string, number>()

  for (const item of items ?? []) {
    const label = String(getLabel(item) ?? '').trim() || fallbackLabel
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'pt-BR'))
    .map(([label, count]) => `${label}: ${count}`)
    .join(' | ')
}

export function normalizeVoyageStatus(status: string | null): 'active' | 'completed' | 'cancelled' {
  if (status === 'completed' || status === 'cancelled') return status
  return 'active'
}

export function formatMetric(value: number | null | undefined) {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount.toLocaleString('pt-BR') : '0'
}

export function tokenizeInfoValue(value: string) {
  if (!value || value === '-') return []

  const tokens = value
    .split('|')
    .map((token) => token.trim())
    .filter(Boolean)

  return tokens.length > 1 ? tokens : []
}

export function stripFileExtension(filename: string) {
  return filename.replace(/\.[^.]+$/, '')
}

// --- Estatísticas de módulos da viagem (extraídas de Viagens.tsx) ---

export type VoyageBl = {
  id: string
  batch_id?: number | null
  cargo_mode: 'container' | 'carga_solta' | null
  ce_mercante: string | null
  bb_machine_qty: number | null
  bb_packages_qty: number | null
  bb_packages_total: number | null
  bb_weight_ton: number | null
  shipper: string | null
  consignee: string | null
  notify_party: string | null
  pol: string | null
  pod: string | null
  total_weight_kg: number | null
  total_cbm: number | null
  bl_containers?: Array<{
    id: number
    container_number: string
    type?: string | null
    is_oog?: boolean | null
    is_imo?: boolean | null
  }> | null
  bl_breakbulk_items?: Array<{
    id: number
    gross_weight_kg?: number | null
    cbm?: number | null
  }> | null
}

export type VoyageGraniteManifest = {
  id: string
  voyage_id: number | null
  loading_port: string | null
  discharge_port: string | null
  total_bls: number | null
  total_weight_kg: number | null
  granite_bls?: Array<{
    id: string
    charge_status: 'not_calculated' | 'calculated' | 'ready_for_billing' | 'invoiced' | null
  }> | null
}

export type VoyageVaziosManifest = {
  id: string
  voyage_id: number | null
  description: string | null
  total_bookings: number | null
  vazios_bookings?: Array<{
    id: string
    container_number: string | null
    container_type: string | null
    origin_terminal: string | null
    destination: string | null
  }> | null
}

export function splitVoyageBls(bls: VoyageBl[] | null | undefined) {
  const containerBls: VoyageBl[] = []
  const breakbulkBls: VoyageBl[] = []

  for (const bl of bls ?? []) {
    if (bl.cargo_mode === 'carga_solta') {
      breakbulkBls.push(bl)
    } else {
      containerBls.push(bl)
    }
  }

  return { containerBls, breakbulkBls }
}

export function countDistinctBatchIds(bls: VoyageBl[] | null | undefined) {
  return new Set((bls ?? []).map((bl) => bl.batch_id).filter((batchId): batchId is number => Number.isInteger(batchId))).size
}

export function getGraniteModuleStats(manifests: VoyageGraniteManifest[] | null | undefined) {
  const totalManifests = manifests?.length ?? 0
  const totalBls = (manifests ?? []).reduce(
    (sum, manifest) => sum + Number(manifest.total_bls ?? manifest.granite_bls?.length ?? 0),
    0,
  )
  const totalWeightTon = (manifests ?? []).reduce(
    (sum, manifest) => sum + Number(manifest.total_weight_kg ?? 0) / 1000,
    0,
  )
  const graniteBls = (manifests ?? []).flatMap((manifest) => manifest.granite_bls ?? [])

  return {
    totalManifests,
    totalBls,
    totalWeightTon,
    readyForBillingCount: graniteBls.filter((bl) => bl.charge_status === 'ready_for_billing').length,
    invoicedCount: graniteBls.filter((bl) => bl.charge_status === 'invoiced').length,
    dischargePorts: summarizeUniqueValues((manifests ?? []).map((manifest) => manifest.discharge_port)),
  }
}

export function getVaziosModuleStats(manifests: VoyageVaziosManifest[] | null | undefined) {
  const totalManifests = manifests?.length ?? 0
  const totalBookings = (manifests ?? []).reduce(
    (sum, manifest) => sum + Number(manifest.total_bookings ?? manifest.vazios_bookings?.length ?? 0),
    0,
  )
  const bookings = (manifests ?? []).flatMap((manifest) => manifest.vazios_bookings ?? [])

  return {
    totalManifests,
    totalBookings,
    distinctContainers: countDistinctContainerNumbers(bookings),
    containerTypes: summarizeOccurrences(bookings, (booking) => booking.container_type, 'Não informado'),
    destinations: summarizeUniqueValues(bookings.map((booking) => booking.destination)),
    originTerminals: summarizeUniqueValues(bookings.map((booking) => booking.origin_terminal)),
  }
}

export function summarizeModuleAvailability({
  hasCntrs,
  hasBreakbulk,
  hasVehicles,
  hasGranite,
  hasVazios,
}: {
  hasCntrs: boolean
  hasBreakbulk: boolean
  hasVehicles: boolean
  hasGranite: boolean
  hasVazios: boolean
}) {
  const modules = []
  if (hasCntrs) modules.push('CNTRS')
  if (hasBreakbulk) modules.push('BB')
  if (hasVehicles) modules.push('VEICULOS')
  if (hasGranite) modules.push('GRANITO')
  if (hasVazios) modules.push('VAZIOS')
  return modules.join('/') || '-'
}
