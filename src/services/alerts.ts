import type { Alert } from '../types/database'
import { supabase } from './supabase'
import { reportBestEffortFailure } from '../lib/telemetry'
import { AGENCY_REPORT_DEPARTMENT_LABELS, agencyReportSectionLabel } from './agencyDepartureReport'

export type { Alert }

export type AlertStatusFilter = 'all' | 'open' | 'acknowledged'

// entity_id dos alertas do ADR é composto (voyageId::porto::departamento,
// migration 225; secao em alertas legados pre-0029) — contrato de
// dedupe/fechamento. Este formatador é só apresentação para a página Alertas.
// Seções aposentadas ('ocorrencias' na ADR 0030, 'operacao_patio' na 0036)
// continuam legíveis via agencyReportSectionLabel, que é a mesma tabela de
// rótulos usada pela função SQL agency_report_section_label — um lugar só para
// manter, em vez de um mapa legado por chamador.
export function formatAgencyReportAlertEntity(entityId: string): string | null {
  const [voyageId, port, key] = entityId.split('::')
  if (!voyageId || !port || !key) return null
  const label = (AGENCY_REPORT_DEPARTMENT_LABELS as Record<string, string>)[key]
    ?? agencyReportSectionLabel(key)
  return `Viagem ${voyageId} · ${port} · ${label}`
}

export async function listAlerts(statusFilter: AlertStatusFilter = 'all'): Promise<Alert[]> {
  let query = supabase
    .from('alerts')
    .select('*')
    .neq('status', 'closed')
    .order('created_at', { ascending: false })
    .range(0, 199)

  if (statusFilter === 'open') {
    query = query.eq('status', 'open')
  } else if (statusFilter === 'acknowledged') {
    query = query.eq('status', 'acknowledged')
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Alert[]
}

export async function acknowledgeAlert(id: number): Promise<void> {
  const { data, error } = await supabase
    .from('alerts')
    .update({ status: 'acknowledged' })
    .eq('id', id)
    .eq('status', 'open')
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('O estado foi alterado por outro usuario. Atualize a lista e tente novamente.')
}

export async function closeAlert(id: number): Promise<void> {
  const { data, error } = await supabase
    .from('alerts')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', id)
    .neq('status', 'closed')
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('O estado foi alterado por outro usuario. Atualize a lista e tente novamente.')
}

export async function createAlert(input: {
  type: string
  entityType: string
  entityId: string
  message: string
}): Promise<void> {
  const { error } = await supabase.from('alerts').insert({
    type: input.type,
    entity_type: input.entityType,
    entity_id: input.entityId,
    message: input.message,
    status: 'open',
  })
  if (error) {
    reportBestEffortFailure('criar alerta financeiro', error, { type: input.type })
  }
}

export async function listFinancialAlerts(): Promise<Alert[]> {
  const { data, error } = await supabase
    .from('alerts')
    .select('*')
    .eq('entity_type', 'invoice')
    .neq('status', 'closed')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []) as Alert[]
}

export async function detectOverdueInvoices(): Promise<void> {
  await supabase.rpc('detect_overdue_invoices')
}

export async function detectAgencyReportPending(): Promise<void> {
  const { error } = await supabase.rpc('detect_agency_report_pending')
  if (error) throw error
}

export async function detectAgencyReportDeadlineMissed(): Promise<void> {
  const { error } = await supabase.rpc('detect_agency_report_deadline_missed')
  if (error) throw error
}
