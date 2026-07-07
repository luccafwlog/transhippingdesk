import { assertUploadFile } from '../lib/fileGuard'

export async function parseVesselScheduleFile(file: File): Promise<Record<string, unknown>[]> {
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  const XLSX = await import('@e965/xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { cellDates: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('Planilha sem aba valida.')
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true })
}
