import { supabase } from './supabase'

export type VoyageExportSchedule = {
  id: string
  voyageId: number
  hasGranite: boolean
  containersQty: number | null
  movementsQty: number | null
  eta: string | null
  etb: string | null
}

export async function fetchExportSchedulesByVoyageIds(voyageIds: number[]): Promise<Map<number, VoyageExportSchedule>> {
  if (!voyageIds.length) return new Map()

  const { data, error } = await supabase
    .from('voyage_export_schedules')
    .select('id, voyage_id, has_granite, containers_qty, movements_qty, eta, etb')
    .in('voyage_id', voyageIds)

  if (error) throw error

  const result = new Map<number, VoyageExportSchedule>()
  for (const row of data ?? []) {
    result.set(row.voyage_id, {
      id: row.id,
      voyageId: row.voyage_id,
      hasGranite: row.has_granite,
      containersQty: row.containers_qty,
      movementsQty: row.movements_qty,
      eta: row.eta,
      etb: row.etb,
    })
  }
  return result
}

export async function saveVoyageExportSchedule(data: {
  voyageId: number
  hasGranite: boolean
  containersQty: number | null
  movementsQty: number | null
  eta: string | null
  etb: string | null
}): Promise<void> {
  const { error } = await supabase
    .from('voyage_export_schedules')
    .upsert(
      {
        voyage_id: data.voyageId,
        has_granite: data.hasGranite,
        containers_qty: data.containersQty,
        movements_qty: data.movementsQty,
        eta: data.eta,
        etb: data.etb,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'voyage_id' },
    )

  if (error) throw error
}

export async function deleteVoyageExportSchedule(id: string): Promise<void> {
  const { error } = await supabase.from('voyage_export_schedules').delete().eq('id', id)
  if (error) throw error
}
