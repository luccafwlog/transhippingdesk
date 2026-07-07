import { createInvoiceFromBls, createInvoiceFromGraniteBls } from './billing'
import { markGraniteBlReady } from './charges/chargeOperationsService'
import { calculateGraniteBlCharges } from './graniteCharges'

export async function calculateAndIssueGraniteInvoice(input: {
  blId: string
  customerId: number
  actorId?: string | null
}) {
  const lines = await calculateGraniteBlCharges(input.blId)
  await markGraniteBlReady(input.blId)
  const invoice = await createInvoiceFromGraniteBls({
    graniteBlIds: [input.blId],
    customerId: input.customerId,
    actorId: input.actorId ?? null,
  })
  return { lines, invoice }
}

export async function issueOperationalInvoice(input: {
  blId: string
  cargoMode: string | null
  customerId: number
  actorId?: string | null
}) {
  if (input.cargoMode === 'granito') {
    return createInvoiceFromGraniteBls({
      graniteBlIds: [input.blId],
      customerId: input.customerId,
      actorId: input.actorId ?? null,
    })
  }

  return createInvoiceFromBls({
    blIds: [input.blId],
    customerId: input.customerId,
    issueNow: true,
    actorId: input.actorId ?? null,
  })
}

export async function runGraniteBatch(ids: string[], action: 'recalculate' | 'review' | 'ready') {
  if (action === 'review') {
    const message = 'Revisão em lote não é suportada para Granito.'
    return {
      total: ids.length,
      successCount: 0,
      errorCount: ids.length,
      errors: ids.map((blId) => ({ blId, message })),
    }
  }

  const worker = action === 'ready' ? markGraniteBlReady : calculateGraniteBlCharges
  const errors: Array<{ blId: string; message: string }> = []
  let successCount = 0

  for (const id of ids) {
    try {
      await worker(id)
      successCount += 1
    } catch (error) {
      errors.push({
        blId: id,
        message: error instanceof Error ? error.message : 'Erro inesperado no processamento Granito.',
      })
    }
  }

  return {
    total: ids.length,
    successCount,
    errorCount: errors.length,
    errors,
  }
}
