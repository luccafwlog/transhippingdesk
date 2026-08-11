import { createInvoiceFromBls, createInvoiceFromGraniteBls } from './billing'
import { markGraniteBlReady } from './charges/chargeOperationsService'
import { calculateGraniteBlCharges } from './graniteCharges'

export async function calculateAndIssueGraniteInvoice(input: { blId: string; customerId: number; actorId?: string | null }) {
  const lines = await calculateGraniteBlCharges(input.blId)
  await markGraniteBlReady(input.blId)
  const invoice = await createInvoiceFromGraniteBls({ graniteBlIds: [input.blId], customerId: input.customerId, actorId: input.actorId ?? null })
  return { lines, invoice }
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
