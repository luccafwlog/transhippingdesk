import { supabase } from '../supabase'

type CustomerReconciliationQueueRow = {
  id: number
  manifest_id: number | null
  bl_id: string
  customer_id: number | null
  current_customer_name: string | null
  cnpj_cpf: string | null
  manifest_customer_name: string | null
  manifest_customer_email: string | null
  detection_type: 'document' | 'name' | 'missing' | 'manual'
  status: 'pending' | 'approved' | 'rejected'
  notes: string | null
  resolution_notes: string | null
  charge_status: string | null
  financial_status: string | null
  billing_hold_reason: string | null
  created_at: string
  approved_at: string | null
  rejected_at: string | null
}

export async function listCustomerReconciliationQueue(status?: '' | 'pending' | 'approved' | 'rejected', limit = 200) {
  const { data, error } = await supabase.rpc('list_customer_reconciliation_queue', {
    ...(status ? { p_status: status } : {}),
    p_limit: limit,
  })

  if (error) throw error
  return (data ?? []) as CustomerReconciliationQueueRow[]
}

export async function approveCustomerReconciliation(
  queueId: number,
  input?: {
    customerId?: number | null
    notes?: string | null
    actorId?: string | null
  },
) {
  const { data, error } = await supabase.rpc('approve_customer_reconciliation', {
    p_queue_id: queueId,
    ...(input?.customerId == null ? {} : { p_customer_id: input.customerId }),
    ...(input?.notes == null ? {} : { p_notes: input.notes }),
    ...(input?.actorId == null ? {} : { p_actor: input.actorId }),
  })

  if (error) throw error
  return data
}

export async function rejectCustomerReconciliation(
  queueId: number,
  input?: {
    notes?: string | null
    actorId?: string | null
  },
) {
  const { data, error } = await supabase.rpc('reject_customer_reconciliation', {
    p_queue_id: queueId,
    ...(input?.notes == null ? {} : { p_notes: input.notes }),
    ...(input?.actorId == null ? {} : { p_actor: input.actorId }),
  })

  if (error) throw error
  return data
}
