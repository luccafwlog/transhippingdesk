import { supabase } from '../supabase'

export type DemurrageDisputeMessage = {
  id: number
  author_type: 'cliente' | 'equipamentos' | 'sistema'
  body: string
  next_responder: 'cliente' | 'equipamentos' | 'ninguem'
  created_at: string
}

export type DemurrageDispute = {
  id: number
  demurrage_invoice_id: number
  doc_number: string
  customer_id: number
  customer_name: string
  state: 'aberta' | 'resolvida' | 'cancelada'
  next_responder: 'cliente' | 'equipamentos' | 'ninguem'
  subject: string | null
  created_at: string
  updated_at: string
  messages: DemurrageDisputeMessage[]
}

const disputeRpc = supabase as unknown as {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>
}

export async function listDemurrageDisputes(state: DemurrageDispute['state'] | null = null): Promise<DemurrageDispute[]> {
  const { data, error } = await disputeRpc.rpc('list_demurrage_disputes_internal', { p_state: state })
  if (error) throw error
  return (Array.isArray(data) ? data : []) as DemurrageDispute[]
}

export async function addDemurrageDisputeMessage(disputeId: number, body: string, nextResponder: DemurrageDispute['next_responder']) {
  const { data, error } = await disputeRpc.rpc('add_demurrage_dispute_message', {
    p_dispute_id: disputeId,
    p_body: body,
    p_next_responder: nextResponder,
  })
  if (error) throw error
  return data
}

export async function reopenDemurrageDispute(disputeId: number, reason: string) {
  const { error } = await disputeRpc.rpc('reopen_demurrage_dispute', { p_dispute_id: disputeId, p_reason: reason })
  if (error) throw error
}
