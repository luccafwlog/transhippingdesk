import { supabase } from './supabase'

export async function saveBlDemurrageConfig({
  blId,
  expectedUpdatedAt,
  freeTime,
  p1,
  p2,
  changedBy,
}: {
  blId: string
  expectedUpdatedAt: string | null
  freeTime: number | null
  p1: number | null
  p2: number | null
  changedBy: string
}) {
  const { error } = await supabase.rpc('save_bl_demurrage_config', {
    p_bl_id: blId,
    p_expected_updated_at: expectedUpdatedAt,
    p_free_time_override: freeTime,
    p_rate_p1_usd: p1,
    p_rate_p2_usd: p2,
    p_changed_by: changedBy,
  })
  if (error) throw error
}
