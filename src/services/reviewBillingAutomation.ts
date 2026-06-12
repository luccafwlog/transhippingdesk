import { markBlReadyAndCreateInvoice } from './billing'
import {
  calculateBlLocalCharges,
  type LocalChargeCalculationResult,
} from './charges/chargeOperationsService'

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
