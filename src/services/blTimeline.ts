import { supabase } from './supabase'

export type BlTimelineFamily = 'edicao' | 'container' | 'taxas' | 'fatura' | 'sistema'

export type BlTimelineEvent = {
  id: number
  family: BlTimelineFamily
  entity_type: string
  field_name: string
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  changed_at: string | null
  justification: string | null
}

export const BL_TIMELINE_PAGE_SIZE = 50

function parseTimelineFamily(value: string): BlTimelineFamily {
  if (value === 'edicao' || value === 'container' || value === 'taxas' || value === 'fatura' || value === 'sistema') return value
  throw new Error(`Família inválida na timeline do B/L: ${value}`)
}

export async function fetchBlTimeline(blId: string, offset: number): Promise<BlTimelineEvent[]> {
  const { data, error } = await supabase.rpc('bl_timeline', {
    p_bl_id: blId,
    p_limit: BL_TIMELINE_PAGE_SIZE,
    p_offset: offset,
  })
  if (error) throw error
  return (data ?? []).map((row) => ({ ...row, family: parseTimelineFamily(row.family) }))
}
