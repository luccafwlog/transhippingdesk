import { supabase } from './supabase'
import type { VoyageExportCeStatus, VoyageExportSchedule as VoyageExportScheduleRow } from '../types/database'

export type ExportCeStatus = VoyageExportCeStatus

export type VoyageExportSchedule = {
  id: string
  voyageId: number
  pol: string | null
  hasGranite: boolean
  containersQty: number | null
  movementsQty: number | null
  eta: string | null
  etb: string | null
  ceStatus: ExportCeStatus | null
  linked: boolean
}

type ExportSchedulePickedRow = Pick<
  VoyageExportScheduleRow,
  'id' | 'voyage_id' | 'pol' | 'has_granite' | 'containers_qty' | 'movements_qty' | 'eta' | 'etb' | 'ce_status' | 'linked'
>

export async function fetchExportSchedulesByVoyageIds(voyageIds: number[]): Promise<Map<number, VoyageExportSchedule>> {
  if (!voyageIds.length) return new Map()

  const { data, error } = await supabase
    .from('voyage_export_schedules')
    .select('id, voyage_id, pol, has_granite, containers_qty, movements_qty, eta, etb, ce_status, linked')
    .in('voyage_id', voyageIds)

  if (error) throw error

  const result = new Map<number, VoyageExportSchedule>()
  for (const row of (data ?? []) as ExportSchedulePickedRow[]) {
    result.set(row.voyage_id, {
      id: row.id,
      voyageId: row.voyage_id,
      pol: row.pol,
      hasGranite: row.has_granite,
      containersQty: row.containers_qty,
      movementsQty: row.movements_qty,
      eta: row.eta,
      etb: row.etb,
      ceStatus: (row.ce_status as ExportCeStatus | null) ?? 'waiting',
      linked: row.linked,
    })
  }
  return result
}

export async function saveVoyageExportSchedule(data: {
  voyageId: number
  pol: string | null
  hasGranite: boolean
  containersQty: number | null
  movementsQty: number | null
  eta: string | null
  etb: string | null
  ceStatus: ExportCeStatus | null
  linked: boolean
}): Promise<void> {
  const { error } = await supabase
    .from('voyage_export_schedules')
    .upsert(
      {
        voyage_id: data.voyageId,
        pol: data.pol,
        has_granite: data.hasGranite,
        containers_qty: data.containersQty,
        movements_qty: data.movementsQty,
        eta: data.eta,
        etb: data.etb,
        ce_status: data.ceStatus,
        linked: data.linked,
        updated_at: new Date().toISOString(),
      } satisfies Partial<VoyageExportScheduleRow>,
      { onConflict: 'voyage_id' },
    )

  if (error) throw error
}

export async function deleteVoyageExportSchedule(id: string): Promise<void> {
  const { error } = await supabase.from('voyage_export_schedules').delete().eq('id', id)
  if (error) throw error
}
