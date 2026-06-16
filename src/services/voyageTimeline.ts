import { supabase } from './supabase'

export type VoyageScheduleEvent = {
  entity_id: string
  field_name: string
  new_value: string | null
  changed_at: string | null
}

export type VoyageResolutionEvent = {
  field_name: string | null
  resolved_at: string | null
}

/**
 * Fontes da linha do tempo de uma viagem: eventos de escala (audit_logs,
 * insert-only) e resoluções de conciliação Baplie↔Manifesto. Sem eventos
 * financeiros, por decisão de produto.
 */
export async function fetchVoyageTimelineSources(
  voyageId: number,
): Promise<{ scheduleEvents: VoyageScheduleEvent[]; resolutions: VoyageResolutionEvent[] }> {
  const [scheduleRes, resolutionRes] = await Promise.all([
    supabase
      .from('audit_logs')
      .select('entity_id, field_name, new_value, changed_at')
      .in('entity_type', ['voyage_pod_schedule', 'voyage_pol_schedule'])
      .like('entity_id', `${voyageId}::%`)
      .order('changed_at', { ascending: false })
      .range(0, 499),
    supabase
      .from('baplie_reconciliation_resolutions')
      .select('field_name, resolved_at')
      .eq('voyage_id', voyageId)
      .order('resolved_at', { ascending: false })
      .range(0, 499),
  ])

  if (scheduleRes.error) throw scheduleRes.error
  if (resolutionRes.error) throw resolutionRes.error

  return {
    scheduleEvents: (scheduleRes.data ?? []) as VoyageScheduleEvent[],
    resolutions: (resolutionRes.data ?? []) as VoyageResolutionEvent[],
  }
}
