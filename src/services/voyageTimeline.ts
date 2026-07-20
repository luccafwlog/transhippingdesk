import { supabase } from './supabase'

export type VoyageScheduleEvent = {
  entity_type?: string | null
  entity_id: string
  field_name: string
  old_value?: string | null
  new_value: string | null
  changed_by?: string | null
  justification?: string | null
  changed_at: string | null
}

export type VoyageAuditEvent = VoyageScheduleEvent

export type VoyageResolutionEvent = {
  field_name: string | null
  resolved_at: string | null
}

export type VoyageBaplieImportEvent = {
  imported_at: string | null
  container_count: number | null
}

/**
 * Fontes da linha do tempo de uma viagem: eventos de escala (audit_logs,
 * insert-only) e resoluções de conciliação Baplie↔Manifesto. Sem eventos
 * financeiros, por decisão de produto.
 */
export async function fetchVoyageTimelineSources(
  voyageId: number,
): Promise<{
  scheduleEvents: VoyageScheduleEvent[]
  auditEvents: VoyageAuditEvent[]
  resolutions: VoyageResolutionEvent[]
  baplieImports: VoyageBaplieImportEvent[]
  actorNames: Record<string, string>
}> {
  const [scheduleRes, auditRes, resolutionRes, baplieRes] = await Promise.all([
    supabase
      .from('audit_logs')
      .select('entity_type, entity_id, field_name, old_value, new_value, changed_by, justification, changed_at')
      .in('entity_type', ['voyage_pod_schedule', 'voyage_pol_schedule'])
      .like('entity_id', `${voyageId}::%`)
      .order('changed_at', { ascending: false })
      .range(0, 499),
    supabase
      .from('audit_logs')
      .select('entity_type, entity_id, field_name, old_value, new_value, changed_by, justification, changed_at')
      .in('entity_type', ['voyages', 'voyage', 'import_batches', 'import_batch'])
      .eq('entity_id', String(voyageId))
      .order('changed_at', { ascending: false })
      .range(0, 499),
    supabase
      .from('baplie_reconciliation_resolutions')
      .select('field_name, resolved_at')
      .eq('voyage_id', voyageId)
      .order('resolved_at', { ascending: false })
      .range(0, 499),
    supabase
      .from('baplie_containers')
      .select('imported_at', { count: 'exact' })
      .eq('voyage_id', voyageId)
      .order('imported_at', { ascending: true })
      .limit(1),
  ])

  if (scheduleRes.error) throw scheduleRes.error
  if (auditRes.error) throw auditRes.error
  if (resolutionRes.error) throw resolutionRes.error
  if (baplieRes.error) throw baplieRes.error

  const actorIds = Array.from(
    new Set([
      ...(scheduleRes.data ?? []).map((row) => row.changed_by),
      ...(auditRes.data ?? []).map((row) => row.changed_by),
    ].filter(Boolean)),
  ) as string[]
  const actorNames: Record<string, string> = {}

  if (actorIds.length) {
    const { data: profiles, error: profilesError } = await supabase
      .from('user_profiles')
      .select('id, full_name')
      .in('id', actorIds)
    if (profilesError) throw profilesError

    for (const profile of profiles ?? []) {
      const row = profile as { id: string; full_name: string | null }
      const name = String(row.full_name ?? '').trim()
      if (name) actorNames[row.id] = name
    }
  }

  return {
    scheduleEvents: (scheduleRes.data ?? []) as VoyageScheduleEvent[],
    auditEvents: (auditRes.data ?? []) as VoyageAuditEvent[],
    resolutions: (resolutionRes.data ?? []) as VoyageResolutionEvent[],
    baplieImports: (baplieRes.data ?? []).map((row) => ({
      imported_at: String((row as { imported_at?: string | null }).imported_at ?? ''),
      container_count: baplieRes.count ?? null,
    })),
    actorNames,
  }
}
