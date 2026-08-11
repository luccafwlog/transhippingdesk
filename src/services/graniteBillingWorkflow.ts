import { createInvoiceFromBls, createInvoiceFromGraniteBls } from './billing'
import { markGraniteBlReady } from './charges/chargeOperationsService'
import { calculateGraniteBlCharges } from './graniteCharges'
import { logOperationalEvent } from './operationalEvents'
import { supabase } from './supabase'

export async function calculateAndIssueGraniteInvoice(input: { blId: string; customerId: number; actorId?: string | null }) {
  const { data: bl, error: blError } = await supabase
    .from('granite_bls')
    .select('charge_status')
    .eq('id', input.blId)
    .single()
  if (blError) throw blError

  const previousStatus = (bl as { charge_status?: string | null }).charge_status ?? null
  const { data: link, error: linkError } = await supabase
    .from('invoice_granite_bls')
    .select('invoice_id, invoice:invoices!inner(status)')
    .eq('granite_bl_id', input.blId)
    .in('invoice.status', ['draft', 'issued', 'partially_paid', 'overdue', 'paid'])
    .maybeSingle()
  if (linkError) throw linkError
  if (previousStatus === 'invoiced' || link) {
    await logOperationalEvent({
      code: 'granite_reimport_already_invoiced',
      message: `Reemissão de CE em B/L Granito já faturado; emissão ignorada.`,
      changedBy: input.actorId ?? null,
      entityId: input.blId,
      context: { source: 'granite_billing_workflow', invoice_id: link?.invoice_id ?? null },
    })
    return { lines: [], invoice: null, skipped: true as const }
  }

  let markedReady = false
  try {
    const lines = await calculateGraniteBlCharges(input.blId)
    await markGraniteBlReady(input.blId)
    markedReady = true
    const invoice = await createInvoiceFromGraniteBls({ graniteBlIds: [input.blId], customerId: input.customerId, actorId: input.actorId ?? null })
    return { lines, invoice }
  } catch (error) {
    if (markedReady) {
      const { error: restoreError } = await supabase.from('granite_bls').update({ charge_status: previousStatus ?? undefined }).eq('id', input.blId)
      if (restoreError) throw restoreError
    }
    throw error
  }
}

export async function issueOperationalInvoice(input: { blId: string; cargoMode: string | null; customerId: number; actorId?: string | null }) {
  if (input.cargoMode === 'granito') {
    const result = await calculateAndIssueGraniteInvoice({ blId: input.blId, customerId: input.customerId, actorId: input.actorId ?? null })
    return result.invoice
  }
  return createInvoiceFromBls({ blIds: [input.blId], customerId: input.customerId, issueNow: true, actorId: input.actorId ?? null })
}

export async function runGraniteBatch(ids: string[], action: 'recalculate' | 'ready') {
  const errors: Array<{ blId: string; message: string }> = []
  let successCount = 0
  for (const id of ids) {
    try {
      if (action === 'recalculate') await calculateGraniteBlCharges(id)
      else await markGraniteBlReady(id)
      successCount += 1
    } catch (error) { errors.push({ blId: id, message: error instanceof Error ? error.message : 'Erro inesperado no processamento Granito.' }) }
  }
  return { total: ids.length, successCount, errorCount: errors.length, errors }
}
