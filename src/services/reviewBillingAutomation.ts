import { createInvoiceFromBls } from './billing'
import { calculateBlLocalCharges, markBlReadyForBilling } from './charges/chargeOperationsService'

export type ReviewBillingAutomationResult =
  | { status: 'invoiced'; invoiceResult: unknown }
  | { status: 'blocked'; message: string }

export async function tryIssueInvoiceAfterCustomerLink({
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
      return { status: 'blocked', message: calculation.reason || 'Taxas locais ainda possuem pendencia de revisao.' }
    }

    if (calculation.exempt || calculation.status === 'exempt') {
      return { status: 'blocked', message: 'B/L isento de taxas locais.' }
    }

    if (Number(calculation.total_brl ?? 0) <= 0 && Number(calculation.total_usd ?? 0) <= 0) {
      return { status: 'blocked', message: 'B/L sem valor faturavel apos recalculo.' }
    }

    await markBlReadyForBilling(blId, actorId)
    const invoiceResult = await createInvoiceFromBls({
      blIds: [blId],
      customerId,
      issueNow: true,
      actorId,
    })

    return { status: 'invoiced', invoiceResult }
  } catch (error) {
    return { status: 'blocked', message: error instanceof Error ? error.message : 'Falha ao gerar invoice automatica.' }
  }
}
