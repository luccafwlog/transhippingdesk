import type { Alert } from '../types/database'
import { supabase } from './supabase'
import { reportBestEffortFailure } from '../lib/telemetry'
import { AGENCY_REPORT_DEPARTMENT_LABELS, agencyReportSectionLabel } from './agencyDepartureReport'

export type { Alert }

export type AlertStatusFilter = 'all' | 'active' | 'dismissed'

export type AlertQueueRow = Alert & {
  item_id: number | null
  item_status: 'active' | 'resolved' | null
  severity: 'normal' | 'critical'
  department: string | null
  destination: string | null
  dismissed_until: string | null
  metadata: Record<string, unknown>
}

type AlertsRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>
}

// database.ts is generated and protected by the repository. New foundation
// RPCs are kept behind this narrow boundary until the next generated type
// refresh, instead of weakening the rest of the Supabase client.
const alertsRpc = supabase as unknown as AlertsRpcClient

// entity_id dos alertas do ADR pode ser um agregado novo (voyageId::porto ou
// voyageId::porto::terminal) ou uma chave legada com departamento/seção. O
// departamento deixou de fazer parte da identidade do agregado, mas as formas
// antigas continuam legíveis durante a transição.
function isTerminalCode(value: string | undefined): boolean {
  return Boolean(value && /^[A-Z0-9][A-Z0-9._-]*$/.test(value))
}

function isTerminalizedAgencyReportKey(value: string | undefined, metadata: Record<string, unknown> = {}): boolean {
  const metadataTerminal = metadata.terminal_code
  return (typeof metadataTerminal === 'string' && metadataTerminal.trim().length > 0)
    || isTerminalCode(value)
}

export function formatAgencyReportAlertEntity(entityId: string): string | null {
  const parts = entityId.split('::')
  const [voyageId, port, third, fourth] = parts
  if (!voyageId || !port || parts.length < 2 || parts.length > 4) return null
  if (parts.length === 2) return `Viagem ${voyageId} · ${port}`

  const terminalized = parts.length === 4 || (parts.length === 3 && isTerminalizedAgencyReportKey(third))
  if (terminalized) {
    const terminalLabel = parts.length === 4 && fourth
      ? ` · ${((AGENCY_REPORT_DEPARTMENT_LABELS as Record<string, string>)[fourth] ?? agencyReportSectionLabel(fourth))}`
      : ''
    return `Viagem ${voyageId} · ${port} · Terminal ${third}${terminalLabel}`
  }

  const label = (AGENCY_REPORT_DEPARTMENT_LABELS as Record<string, string>)[third]
    ?? agencyReportSectionLabel(third)
  return `Viagem ${voyageId} · ${port} · ${label}`
}

export function agencyReportAlertLink(
  entityId: string,
  metadata: Record<string, unknown> = {},
): string | null {
  const parts = entityId.split('::')
  const [voyageId, port, third] = parts
  if (!/^\d+$/.test(voyageId ?? '') || !port || parts.length < 2 || parts.length > 4) return null

  const params = new URLSearchParams({ tab: 'adr', escala: port })
  const terminal = parts.length === 4 || (parts.length === 3 && isTerminalizedAgencyReportKey(third, metadata))
    ? third
    : undefined
  if (terminal) params.set('terminal', terminal)
  const reportId = metadata.report_id
  if (typeof reportId === 'string' && reportId.length > 0) params.set('report', reportId)
  return `/viagens/${voyageId}?${params.toString()}`
}

export async function listAlerts(statusFilter: AlertStatusFilter = 'all', entityType?: string): Promise<AlertQueueRow[]> {
  const { data, error } = await alertsRpc.rpc('list_alert_queue', {
    p_filter: statusFilter,
    ...(entityType ? { p_entity_type: entityType } : {}),
  })
  if (error) throw error
  return (Array.isArray(data) ? data : []) as AlertQueueRow[]
}

export async function countAlertQueue(statusFilter: AlertStatusFilter = 'active'): Promise<number> {
  const { data, error } = await alertsRpc.rpc('count_alert_queue', { p_filter: statusFilter })
  if (error) throw error
  return typeof data === 'number' ? data : Number(data ?? 0)
}

export async function dismissAlertItem(itemId: number, reason: string, reviewAt: string): Promise<void> {
  const { error } = await alertsRpc.rpc('dismiss_alert_item', {
    p_item_id: itemId,
    p_reason: reason,
    p_review_at: reviewAt,
  })
  if (error) throw error
}

// Kept as a compatibility export for old financial consumers while the
// block-specific migrations move their origin resolvers to resolve_alert_item.
// The Alertas UI has no manual close/reconhecimento path anymore.
export async function acknowledgeAlert(_id: number): Promise<void> {
  void _id
  throw new Error('Reconhecimento de alertas não existe mais. Leia a Notificação Interna ou dispense o item.')
}

export async function closeAlert(_id: number): Promise<void> {
  void _id
  throw new Error('Alertas derivados são fechados automaticamente pela origem.')
}

export async function createAlert(input: {
  type: string
  entityType: string
  entityId: string
  message: string
}): Promise<void> {
  const { error } = await alertsRpc.rpc('upsert_alert_item', {
    p_type: input.type,
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_message: input.message,
    p_source: 'client_compatibility',
    p_metadata: {},
  })
  if (error) reportBestEffortFailure('criar item de alerta', error, { type: input.type })
}

export async function resolveAlertItem(input: {
  type: string
  entityType: string
  entityId: string
  source?: string
}): Promise<void> {
  const { error } = await alertsRpc.rpc('resolve_alert_item', {
    p_type: input.type,
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_source: input.source ?? 'client_compatibility',
    p_metadata: {},
  })
  if (error) reportBestEffortFailure('resolver item de alerta', error, { type: input.type })
}

export async function listFinancialAlerts(): Promise<AlertQueueRow[]> {
  return listAlerts('active', 'invoice')
}

// Deprecated browser compatibility. The only production scheduler is the
// server-only alerts-detector Edge Function from migration 319.
export async function detectOverdueInvoices(): Promise<void> {
  const { error } = await supabase.rpc('detect_overdue_invoices')
  if (error) throw error
}

export async function detectAgencyReportPending(): Promise<void> {
  const { error } = await supabase.rpc('detect_agency_report_pending')
  if (error) throw error
}

export async function detectAgencyReportDeadlineMissed(): Promise<void> {
  const { error } = await supabase.rpc('detect_agency_report_deadline_missed')
  if (error) throw error
}

export type InternalNotification = {
  id: number
  alert_id: number
  alert_item_id: number
  item_type: string
  severity: 'normal' | 'critical'
  title: string
  message: string
  entity_type: string | null
  entity_id: string | null
  destination: string | null
  is_fallback: boolean
  read_at: string | null
  created_at: string
  payload: Record<string, unknown>
}

export async function listInternalNotifications(includeRead = false): Promise<InternalNotification[]> {
  const { data, error } = await alertsRpc.rpc('list_internal_notifications', { p_include_read: includeRead })
  if (error) throw error
  return (Array.isArray(data) ? data : []) as InternalNotification[]
}

export async function markInternalNotificationRead(notificationId: number): Promise<void> {
  const { error } = await alertsRpc.rpc('mark_internal_notification_read', { p_notification_id: notificationId })
  if (error) throw error
}
