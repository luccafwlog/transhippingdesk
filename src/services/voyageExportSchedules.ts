import { supabase } from './supabase'
import { normalizePortCode } from './portCode'
import type { VoyageExportCeStatus, VoyageExportSchedule as VoyageExportScheduleRow } from '../types/database'

export type ExportCeStatus = VoyageExportCeStatus

export type VoyageExportSchedule = {
  id: string
  voyageId: number
  pol: string | null
  temExportacao: boolean
  hasGranite: boolean
  containersQty: number | null
  movementsQty: number | null
  ceStatus: ExportCeStatus | null
  linked: boolean
}

export type VoyageExportSchedulesByPort = Map<string, VoyageExportSchedule>

type ExportSchedulePickedRow = Pick<
  VoyageExportScheduleRow,
  'id' | 'voyage_id' | 'pol' | 'tem_exportacao' | 'has_granite' | 'containers_qty' | 'movements_qty' | 'ce_status' | 'linked'
>

export async function fetchExportSchedulesByVoyageIds(voyageIds: number[]): Promise<Map<number, VoyageExportSchedulesByPort>> {
  if (!voyageIds.length) return new Map()

  const { data, error } = await supabase
    .from('voyage_export_schedules')
    .select('id, voyage_id, pol, tem_exportacao, has_granite, containers_qty, movements_qty, ce_status, linked')
    .in('voyage_id', voyageIds)

  if (error) throw error

  const grouped = new Map<number, Array<{ portKey: string; schedule: VoyageExportSchedule }>>()
  for (const row of (data ?? []) as ExportSchedulePickedRow[]) {
    const schedule = {
      id: row.id,
      voyageId: row.voyage_id,
      pol: row.pol,
      temExportacao: row.tem_exportacao,
      hasGranite: row.has_granite,
      containersQty: row.containers_qty,
      movementsQty: row.movements_qty,
      ceStatus: (row.ce_status as ExportCeStatus | null) ?? 'waiting',
      linked: row.linked,
    }
    const current = grouped.get(row.voyage_id) ?? []
    current.push({ portKey: buildExportSchedulePortKey(schedule), schedule })
    grouped.set(row.voyage_id, current)
  }

  const result = new Map<number, VoyageExportSchedulesByPort>()
  for (const [voyageId, schedules] of grouped) {
    const byPort = new Map<string, VoyageExportSchedule>()
    for (const { portKey, schedule } of schedules.sort((left, right) => left.portKey.localeCompare(right.portKey, 'pt-BR'))) {
      byPort.set(portKey, schedule)
    }
    result.set(voyageId, byPort)
  }
  return result
}

export async function saveVoyageExportSchedule(data: {
  existingId?: string | null
  voyageId: number
  pol: string | null
  temExportacao: boolean
  hasGranite: boolean
  containersQty: number | null
  movementsQty: number | null
  ceStatus: ExportCeStatus | null
  linked: boolean
}): Promise<void> {
  const normalizedPol = normalizeExportSchedulePol(data.pol)
  // A exportação é de uma escala; sem porto não há escala a que pertencer.
  if (!normalizedPol) throw new Error('A exportação exige o porto da escala.')

  const payload = {
    voyage_id: data.voyageId,
    pol: normalizedPol,
    tem_exportacao: data.temExportacao,
    has_granite: data.hasGranite,
    containers_qty: data.containersQty,
    movements_qty: data.movementsQty,
    ce_status: data.ceStatus,
    linked: data.linked,
    updated_at: new Date().toISOString(),
  } satisfies Partial<VoyageExportScheduleRow>

  if (data.existingId) {
    const { error } = await supabase
      .from('voyage_export_schedules')
      .update(payload)
      .eq('id', data.existingId)

    if (error) throw error
    return
  }

  const { error } = await supabase
    .from('voyage_export_schedules')
    .upsert(
      payload,
      { onConflict: 'voyage_id,pol' },
    )

  if (error) throw error
}

export async function deleteVoyageExportSchedule(id: string): Promise<void> {
  const { error } = await supabase.from('voyage_export_schedules').delete().eq('id', id)
  if (error) throw error
}

function buildExportSchedulePortKey(schedule: Pick<VoyageExportSchedule, 'id' | 'pol'>) {
  return normalizeExportSchedulePol(schedule.pol) ?? `__missing_pol__::${schedule.id}`
}

function normalizeExportSchedulePol(value: string | null | undefined) {
  const normalized = normalizePortCode(value)
  if (normalized) return normalized
  const trimmed = String(value ?? '').trim().toUpperCase()
  return trimmed || null
}
