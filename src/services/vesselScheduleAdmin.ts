import { supabase } from './supabase'

export async function archiveVesselSchedule(vesselId: string) {
  const { error } = await supabase.rpc('archive_vessel_schedule', {
    p_vessel_id: vesselId,
  })
  if (error) throw error
}

export async function reorderVesselSchedules(
  rows: Array<{ id: string; displayOrder: number }>,
) {
  const { error } = await supabase.rpc('reorder_vessel_schedules', {
    p_order: rows.map((row) => ({
      id: row.id,
      display_order: row.displayOrder,
    })),
  })
  if (error) throw error
}
