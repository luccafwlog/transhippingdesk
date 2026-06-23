import { supabase } from './supabase'

export type AuditLogRow = {
  id: number
  entity_type: string
  entity_id: string
  field_name: string | null
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  changed_at: string
  justification: string | null
  changer_name: string | null
}

export const LOG_PAGE_SIZE = 50

export type LogFilters = {
  entityType: string
  changedBy: string
  dateFrom: string
  dateTo: string
  page: number
}

export async function fetchAuditLogs(filters: LogFilters): Promise<{ rows: AuditLogRow[]; count: number }> {
  const from = filters.page * LOG_PAGE_SIZE
  const to = from + LOG_PAGE_SIZE - 1

  let query = supabase
    .from('audit_logs')
    .select('id, entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification', { count: 'exact' })
    .order('changed_at', { ascending: false })
    .range(from, to)

  if (filters.entityType) query = query.eq('entity_type', filters.entityType)
  if (filters.changedBy) query = query.eq('changed_by', filters.changedBy)
  if (filters.dateFrom) query = query.gte('changed_at', filters.dateFrom + 'T00:00:00')
  if (filters.dateTo) query = query.lte('changed_at', filters.dateTo + 'T23:59:59')

  const { data, error, count } = await query
  if (error) throw error

  const rows = (data ?? []) as unknown as Omit<AuditLogRow, 'changer_name'>[]
  if (!rows.length) return { rows: [], count: count ?? 0 }

  const changerIds = Array.from(new Set(rows.map((r) => r.changed_by).filter(Boolean))) as string[]
  const nameById = new Map<string, string>()
  if (changerIds.length) {
    const { data: profiles, error: profilesError } = await supabase.from('user_profiles').select('id, full_name').in('id', changerIds)
    if (profilesError) throw profilesError
    for (const p of profiles ?? []) nameById.set((p as { id: string; full_name: string }).id, (p as { id: string; full_name: string }).full_name)
  }

  return {
    rows: rows.map((r) => ({ ...r, changer_name: r.changed_by ? (nameById.get(r.changed_by) ?? r.changed_by) : null })),
    count: count ?? 0,
  }
}

export async function fetchSystemMetrics() {
  const [voyageRes, reconRes, invoiceRes] = await Promise.all([
    supabase.from('voyages').select('created_at').order('created_at', { ascending: false }).limit(1),
    supabase.from('audit_logs').select('changed_at').eq('entity_type', 'pix_reconciliation').order('changed_at', { ascending: false }).limit(1),
    supabase.from('invoices').select('created_at').order('created_at', { ascending: false }).limit(1),
  ])

  if (voyageRes.error) throw voyageRes.error
  if (reconRes.error) throw reconRes.error
  if (invoiceRes.error) throw invoiceRes.error

  return {
    lastVoyageAt: voyageRes.data?.[0]?.created_at ?? null,
    lastPixReconAt: (reconRes.data?.[0] as { changed_at?: string } | undefined)?.changed_at ?? null,
    lastInvoiceAt: invoiceRes.data?.[0]?.created_at ?? null,
  }
}
