import { calculateGraniteBlCharges } from './graniteCharges'
import { markGraniteBlReady } from './charges/chargeOperationsService'

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
