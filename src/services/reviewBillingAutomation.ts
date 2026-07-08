import { markBlReadyAndCreateInvoice } from './billing'
import {
  calculateBlLocalCharges,
  type LocalChargeCalculationResult,
} from './charges/chargeOperationsService'
import { supabase } from './supabase'

export type ReviewBillingAutomationResult =
  | { status: 'invoiced'; invoiceResult: unknown }
  | { status: 'blocked'; message: string; calculation?: LocalChargeCalculationResult }

export async function tryAutoIssueInvoice({
  blId,
  customerId,
  actorId,
}: {
  blId: string
  customerId: number
  actorId: string | null
}): Promise<ReviewBillingAutomationResult> {
  try {
    const { data: bl, error: blError } = await supabase
      .from('bls')
      .select('ce_mercante, cargo_mode')
      .eq('id', blId)
      .single()
    if (blError) throw blError

    const cargoMode = (bl as { cargo_mode?: string | null } | null)?.cargo_mode ?? 'container'
    const ceMercante = (bl as { ce_mercante?: string | null } | null)?.ce_mercante?.trim() ?? ''
    if ((cargoMode === 'container' || cargoMode === '') && !ceMercante) {
      return { status: 'blocked', message: 'Aguardando cadastro do CE Mercante para calcular taxas (ADR 0020).' }
    }

    const calculation = await calculateBlLocalCharges(blId, { actorId, recalculate: true })

    if (calculation.review_required || calculation.status === 'review_required') {
      return { status: 'blocked', message: calculation.reason || 'Taxas locais ainda possuem pendencia de revisao.', calculation }
    }

    if (calculation.exempt || calculation.status === 'exempt') {
      return { status: 'blocked', message: 'B/L isento de taxas locais.', calculation }
    }

    if (Number(calculation.total_brl ?? 0) <= 0 && Number(calculation.total_usd ?? 0) <= 0) {
      return { status: 'blocked', message: 'B/L sem valor faturavel apos recalculo.', calculation }
    }

    const invoiceResult = await markBlReadyAndCreateInvoice({
      blId,
      customerId,
      actorId,
    })

    return { status: 'invoiced', invoiceResult }
  } catch (error) {
    return { status: 'blocked', message: error instanceof Error ? error.message : 'Falha ao gerar invoice automatica.' }
  }
}

export async function maybeAutoBillAfterCeMercante(blId: string, actorId: string | null) {
  const { data, error } = await supabase
    .from('bls')
    .select('id, customer_id, customer_reconciliation_status, cargo_mode')
    .eq('id', blId)
    .single()
  if (error) throw error

  const bl = data as {
    id: string
    customer_id: number | null
    customer_reconciliation_status: string | null
    cargo_mode: string | null
  } | null

  if (!bl?.customer_id || bl.customer_reconciliation_status !== 'matched_document') return null
  const cargoMode = bl.cargo_mode ?? 'container'
  if (cargoMode !== 'container' && cargoMode !== '') return null

  return tryAutoIssueInvoice({ blId: bl.id, customerId: bl.customer_id, actorId })
}
