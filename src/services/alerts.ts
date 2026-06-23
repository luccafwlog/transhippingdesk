import type { Alert } from '../types/database'
import { supabase } from './supabase'
import { reportBestEffortFailure } from '../lib/telemetry'

export type { Alert }

export type AlertStatusFilter = 'all' | 'open' | 'acknowledged'

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
