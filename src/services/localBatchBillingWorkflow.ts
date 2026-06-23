import { markBlsReadyAndCreateInvoice } from './billing'

export async function runAtomicLocalBatchBilling(
  rows: Array<{ id: string; customerId: number | null }>,
  actorId?: string | null,
) {
  const groups = new Map<number, string[]>()
  const errors: Array<{ blId: string; message: string }> = []

  for (const row of rows) {
    if (!row.customerId) {
      errors.push({ blId: row.id, message: 'B/L sem cliente vinculado.' })
      continue
    }
    const ids = groups.get(row.customerId) ?? []
    ids.push(row.id)
    groups.set(row.customerId, ids)
  }

  let successCount = 0
  let invoicedCount = 0
  for (const [customerId, blIds] of groups) {
    try {
      await markBlsReadyAndCreateInvoice({ blIds, customerId, actorId })
      successCount += blIds.length
      invoicedCount += blIds.length
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao promover e faturar B/Ls.'
      errors.push(...blIds.map((blId) => ({ blId, message })))
    }
  }

  return {
    total: rows.length,
    successCount,
    errorCount: errors.length,
    errors,
    invoicedCount,
  }
}
