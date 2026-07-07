import { supabasePortal } from './supabase'

export type PortalOperationContainerStatus =
  | 'sem_descarga'
  | 'dentro_free_time'
  | 'em_demurrage'
  | 'devolvido'

export type PortalOperationContainer = {
  id: number
  container_number: string
  type: string | null
  discharge_date: string | null
  return_date: string | null
  usage_days: number | null
  free_time_days: number | null
  demurrage_days: number | null
  status: PortalOperationContainerStatus
}

export type PortalOperationBL = {
  bl_id: string
  ce_mercante: string | null
  pol: string | null
  pod: string | null
  voyage_id: number | null
  voyage_number: string | null
  vessel_name: string | null
  container_count: number
  containers_in_demurrage: number
  containers_returned: number
  containers: PortalOperationContainer[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asStringOrNull(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text || null
}

function asNumberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function asCount(value: unknown): number {
  return asNumberOrNull(value) ?? 0
}

function asStatus(value: unknown): PortalOperationContainerStatus {
  if (
    value === 'sem_descarga' ||
    value === 'dentro_free_time' ||
    value === 'em_demurrage' ||
    value === 'devolvido'
  ) {
    return value
  }
  return 'sem_descarga'
}

function normalizeContainer(value: unknown): PortalOperationContainer {
  const row = asRecord(value)

  return {
    id: asCount(row.id),
    container_number: asStringOrNull(row.container_number) ?? '',
    type: asStringOrNull(row.type),
    discharge_date: asStringOrNull(row.discharge_date),
    return_date: asStringOrNull(row.return_date),
    usage_days: asNumberOrNull(row.usage_days),
    free_time_days: asNumberOrNull(row.free_time_days),
    demurrage_days: asNumberOrNull(row.demurrage_days),
    status: asStatus(row.status),
  }
}

export function normalizePortalOperationRows(data: unknown): PortalOperationBL[] {
  const rows = Array.isArray(data) ? data : []

  return rows.map((value) => {
    const row = asRecord(value)
    const containers = Array.isArray(row.containers) ? row.containers.map(normalizeContainer) : []

    return {
      bl_id: asStringOrNull(row.bl_id) ?? '',
      ce_mercante: asStringOrNull(row.ce_mercante),
      pol: asStringOrNull(row.pol),
      pod: asStringOrNull(row.pod),
      voyage_id: asNumberOrNull(row.voyage_id),
      voyage_number: asStringOrNull(row.voyage_number),
      vessel_name: asStringOrNull(row.vessel_name),
      container_count: asCount(row.container_count),
      containers_in_demurrage: asCount(row.containers_in_demurrage),
      containers_returned: asCount(row.containers_returned),
      containers,
    }
  })
}

export async function portalListOperationBls(): Promise<PortalOperationBL[]> {
  const { data, error } = await supabasePortal.rpc('portal_list_operation_bls')

  if (error) throw error

  return normalizePortalOperationRows(data)
}
