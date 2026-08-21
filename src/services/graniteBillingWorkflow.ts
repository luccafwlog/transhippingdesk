import { calculateGraniteBlCharges } from './graniteCharges'

export async function runGraniteBatch(ids: string[]) {
  const errors: Array<{ blId: string; message: string }> = []
  let successCount = 0
  for (const id of ids) {
    try {
      await calculateGraniteBlCharges(id)
      successCount += 1
    } catch (error) { errors.push({ blId: id, message: error instanceof Error ? error.message : 'Erro inesperado no processamento Granito.' }) }
  }
  return { total: ids.length, successCount, errorCount: errors.length, errors }
}
