import { markBlReadyAndCreateInvoice } from './billing'
import {
  calculateBlLocalCharges,
  type LocalChargeCalculationResult,
} from './charges/chargeOperationsService'
import { logOperationalEvent } from './operationalEvents'
import { createAlert, resolveAlertItem } from './alerts'
import { supabase } from './supabase'
import { isCustomerReconciliationResolved } from './customerReconciliation'

export type ReviewBillingAutomationResult =
  | { status: 'invoiced'; invoiceResult: unknown }
  | { status: 'blocked'; message: string; reason: 'calculation_blocked' | 'rpc_error' | 'awaiting_flow'; calculation?: LocalChargeCalculationResult; unexpected?: boolean }

type BillingAttemptBl = {
  ce_mercante: string | null
  cargo_mode: string | null
  customer_id: number | null
  customer_reconciliation_status: string | null
  review_status: string | null
  billing_hold_reason: string | null
}

type CalculationBlockReason = 'review:no_table' | 'pending_review' | 'invalid_lines' | 'billing_hold_reason' | 'no_billable_value'

type CalculationBlock = {
  reason: CalculationBlockReason
  message: string
}

function hasInvalidCalculationLines(calculation: LocalChargeCalculationResult) {
  const totals = [calculation.total_brl, calculation.total_usd]
  return calculation.line_count < 0
    || totals.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)
    || /(linha|line).*(inválid|invalid)/i.test(calculation.reason)
}

function getCalculationBlock(
  bl: BillingAttemptBl,
  customerId: number | null,
  calculation: LocalChargeCalculationResult,
): CalculationBlock | null {
  // Cliente ausente/reconciliação pendente é propriedade do fluxo #520.
  // Não duplicar a pendência de revisão como bloqueio financeiro.
  if (!customerId || !bl.customer_id || !isCustomerReconciliationResolved(bl.customer_reconciliation_status)) return null
  if (calculation.exempt || calculation.status === 'exempt') return null

  const calculationReason = calculation.reason.trim()
  if (/review:no_table/i.test(calculationReason) || calculation.status === 'not_calculated' && bl.billing_hold_reason?.trim()) {
    return { reason: 'review:no_table', message: calculationReason || 'Tabela de taxas locais ausente ou inválida.' }
  }
  if (bl.review_status === 'pending_review') {
    return { reason: 'pending_review', message: bl.billing_hold_reason ?? (calculationReason || 'Revisão pendente antes do faturamento.') }
  }
  if (bl.billing_hold_reason?.trim()) {
    return { reason: 'billing_hold_reason', message: bl.billing_hold_reason }
  }
  if (hasInvalidCalculationLines(calculation)) {
    return { reason: 'invalid_lines', message: calculationReason || 'Há linhas de taxa inválidas.' }
  }
  if (calculation.review_required || calculation.status === 'review_required') {
    return null
  }
  if (Number(calculation.total_brl ?? 0) <= 0 && Number(calculation.total_usd ?? 0) <= 0) {
    return { reason: 'no_billable_value', message: 'B/L sem valor faturavel apos recalculo.' }
  }

  // Peso BB e outras pendências previstas da revisão retornam para o fluxo
  // operacional sem produzir A2.
  return null
}

function calculationAlertMetadata(
  bl: BillingAttemptBl,
  calculation: LocalChargeCalculationResult,
  reason: CalculationBlockReason,
) {
  return {
    source: 'authoritative_local_calculation',
    correction_route: '/taxas-locais',
    reason,
    calculation_status: calculation.status,
    table_id: calculation.table_id,
    line_count: calculation.line_count,
    total_brl: calculation.total_brl,
    total_usd: calculation.total_usd,
    review_status: bl.review_status,
    billing_hold_reason: bl.billing_hold_reason,
  }
}

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
    const { data: blData, error: blError } = await supabase
      .from('bls')
      .select('ce_mercante, cargo_mode, customer_id, customer_reconciliation_status, review_status, billing_hold_reason')
      .eq('id', blId)
      .single()
    if (blError) throw blError

    const bl = (blData ?? {}) as Partial<BillingAttemptBl>
    const cargoMode = bl.cargo_mode ?? 'container'
    const ceMercante = bl.ce_mercante?.trim() ?? ''

    let calculation: LocalChargeCalculationResult
    try {
      calculation = await calculateBlLocalCharges(blId, { actorId, recalculate: true })
    } catch (error) {
      return {
        status: 'blocked',
        reason: 'rpc_error',
        message: error instanceof Error ? error.message : 'Falha ao calcular taxas locais.',
        unexpected: true,
      }
    }

    const attemptBl: BillingAttemptBl = {
      ce_mercante: bl.ce_mercante ?? null,
      cargo_mode: bl.cargo_mode ?? null,
      customer_id: bl.customer_id ?? null,
      customer_reconciliation_status: bl.customer_reconciliation_status ?? null,
      review_status: bl.review_status ?? null,
      billing_hold_reason: bl.billing_hold_reason ?? null,
    }
    const calculationBlock = getCalculationBlock(attemptBl, customerId, calculation)
    if (calculationBlock) {
      await createAlert({
        type: 'billing_calculation_blocked',
        entityType: 'bl',
        entityId: blId,
        message: calculationBlock.message,
        metadata: calculationAlertMetadata(attemptBl, calculation, calculationBlock.reason),
      })
      return { status: 'blocked', reason: 'calculation_blocked', message: calculationBlock.message, calculation }
    }

    if (calculation.review_required || calculation.status === 'review_required') {
      return { status: 'blocked', reason: 'awaiting_flow', message: calculation.reason || 'Taxas locais ainda possuem pendencia de revisao.', calculation }
    }

    if (calculation.exempt || calculation.status === 'exempt') {
      await resolveAlertItem({
        type: 'billing_calculation_blocked',
        entityType: 'bl',
        entityId: blId,
        source: 'billing_calculation',
        metadata: { resolution: 'exemption_valid', correction_route: '/taxas-locais' },
      })
      return { status: 'blocked', reason: 'awaiting_flow', message: 'B/L isento de taxas locais.', calculation }
    }

    await resolveAlertItem({
      type: 'billing_calculation_blocked',
      entityType: 'bl',
      entityId: blId,
      source: 'billing_calculation',
      metadata: { resolution: 'calculation_valid', correction_route: '/taxas-locais' },
    })

    // Etapa 4 do plano de faturamento (ADR 0038, achado 11): o CE Mercante deixou
    // de ser exigido para calcular (o cálculo provisório já rodou no import ou
    // acima), mas continua exigido para emitir — a fatura precisa do documento.
    if ((cargoMode === 'container' || cargoMode === '') && !ceMercante) {
      return { status: 'blocked', reason: 'awaiting_flow', message: 'Aguardando cadastro do CE Mercante para emitir a fatura (ADR 0020).', calculation }
    }

    const invoiceResult = await markBlReadyAndCreateInvoice({
      blId,
      customerId,
      actorId,
    })

    await resolveAlertItem({
      type: 'billing_auto_issue_failed',
      entityType: 'bl',
      entityId: blId,
      source: 'ce_auto_billing',
    })

    return { status: 'invoiced', invoiceResult }
  } catch (error) {
    return {
      status: 'blocked',
      reason: 'rpc_error',
      message: error instanceof Error ? error.message : 'Falha ao gerar invoice automatica.',
      unexpected: true,
    }
  }
}

export async function maybeAutoBillAfterCeMercante(blId: string, actorId: string | null) {
  const { data, error } = await supabase
    .from('bls')
    .select('id, customer_id, customer_reconciliation_status, cargo_mode, financial_status')
    .eq('id', blId)
    .single()
  if (error) throw error

  const bl = data as {
    id: string
    customer_id: number | null
    customer_reconciliation_status: string | null
    cargo_mode: string | null
    financial_status: string | null
  } | null

  if (!bl?.customer_id || bl.customer_reconciliation_status !== 'matched_document') return null
  const cargoMode = bl.cargo_mode ?? 'container'
  if (cargoMode !== 'container' && cargoMode !== '') return null

  // Reimport de CE em B/L ja faturado e no-op benigno: create_invoice_from_bls_core
  // recusaria a segunda fatura. Registramos como info e nao tentamos refaturar.
  if ((bl.financial_status ?? 'pending') !== 'pending') {
    await logOperationalEvent({
      code: 'ce_reimport_already_invoiced',
      message: `Reimport de CE Mercante em B/L ja faturado (${bl.financial_status}); refaturamento ignorado.`,
      changedBy: actorId,
      entityId: bl.id,
      context: { source: 'ce_auto_billing', financial_status: bl.financial_status },
    })
    return null
  }

  const result = await tryAutoIssueInvoice({ blId: bl.id, customerId: bl.customer_id, actorId })
  if (result.status === 'blocked' && result.reason === 'rpc_error') {
    await createAlert({
      type: 'billing_auto_issue_failed',
      entityType: 'bl',
      entityId: bl.id,
      message: result.message,
      metadata: { source: 'local_invoice_emission', correction_route: '/taxas-locais', failure_stage: 'emission' },
    })
    await logOperationalEvent({
      code: 'bl_auto_billing_failed',
      message: result.message,
      changedBy: actorId,
      entityId: bl.id,
      context: { source: 'ce_auto_billing' },
    })
  }
  return result
}
