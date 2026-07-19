import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exportLineUpWorkbook } from '../exports'
import type { LineUpRow } from '../lineup'

const { jsonToSheet, bookAppendSheet, writeFile } = vi.hoisted(() => ({
  jsonToSheet: vi.fn((rows: unknown[]) => ({ rows })), bookAppendSheet: vi.fn(), writeFile: vi.fn(),
}))

vi.mock('@e965/xlsx', () => ({
  utils: { book_new: vi.fn(() => ({ Sheets: {} })), json_to_sheet: jsonToSheet, book_append_sheet: bookAppendSheet }, writeFile,
}))

describe('exportLineUpWorkbook - injeção de fórmula', () => {
  beforeEach(() => { jsonToSheet.mockClear(); bookAppendSheet.mockClear(); writeFile.mockClear() })
  it('neutraliza valores de célula iniciados por metacaractere de fórmula', async () => {
    const rows = [{ vesselName: '=cmd|calc', voyageNumber: '001', pod: 'SSZ', vin: 1, car: 0, cg: 0, total: 1, mty: 0 }] as unknown as LineUpRow[]
    await exportLineUpWorkbook(rows)
    expect(jsonToSheet).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ Navio: "'=cmd|calc", POD: 'SSZ' })]))
  })
})
