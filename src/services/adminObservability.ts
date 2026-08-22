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

export type RoutingFailureRow = {
  id: number
  alert_id: number | null
  alert_item_id: number | null
  event_id: number | null
  item_type: string
  department: string
  reason: string
  created_at: string
  entity_type?: string | null
  entity_id?: string | null
}

export async function fetchRoutingFailures(page = 0): Promise<{ rows: RoutingFailureRow[]; count: number }> {
  const from = page * LOG_PAGE_SIZE
  const to = from + LOG_PAGE_SIZE - 1

  type RoutingFailureQuery = {
    select: (columns: string, options?: { count: 'exact' }) => RoutingFailureQuery
    order: (column: string, options: { ascending: boolean }) => RoutingFailureQuery
    range: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown | null; count: number | null }>
  }
  const { data, error, count } = await (supabase.from as unknown as (table: string) => RoutingFailureQuery)('alert_notification_failures')
    .select('id, alert_id, alert_item_id, event_id, item_type, department, reason, created_at, alert:alerts(entity_type, entity_id)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw error

  const rows = ((data ?? []) as unknown as Array<{
    id: number
    alert_id: number | null
    alert_item_id: number | null
    event_id: number | null
    item_type: string
    department: string
    reason: string
    created_at: string
    alert?: { entity_type: string | null; entity_id: string | null } | null
  }>).map((r) => ({
    id: r.id,
    alert_id: r.alert_id,
    alert_item_id: r.alert_item_id,
    event_id: r.event_id,
    item_type: r.item_type,
    department: r.department,
    reason: r.reason,
    created_at: r.created_at,
    entity_type: r.alert?.entity_type ?? null,
    entity_id: r.alert?.entity_id ?? null,
  }))

  return {
    rows,
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
