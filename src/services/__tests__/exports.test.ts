import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exportVaziosImportacaoWorkbook } from '../exports'
import type { VaziosImportacaoContainerListItem } from '../../types/database'

const { jsonToSheet, bookAppendSheet, writeFile } = vi.hoisted(() => ({
  jsonToSheet: vi.fn((rows: unknown[]) => ({ rows })),
  bookAppendSheet: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('xlsx', () => ({
  utils: {
    book_new: vi.fn(() => ({ Sheets: {} })),
    json_to_sheet: jsonToSheet,
    book_append_sheet: bookAppendSheet,
  },
  writeFile,
}))

describe('exportVaziosImportacaoWorkbook', () => {
  beforeEach(() => {
    jsonToSheet.mockClear()
    bookAppendSheet.mockClear()
    writeFile.mockClear()
  })

  it('exporta colunas operacionais dos vazios de importacao', async () => {
    const rows: VaziosImportacaoContainerListItem[] = [
      {
        id: '1',
        manifest_id: 'm1',
        container_number: 'ABCD1234567',
        container_type: '40HC',
        tare_kg: 3800,
        pod: 'SSZ',
        created_at: '2026-06-01T10:00:00Z',
        manifest: {
          id: 'm1',
          voyage_id: 10,
          description: 'Baplie',
          imported_at: '2026-06-01T10:00:00Z',
          voyage: {
            voyage_number: '001',
            vessel: { name: 'NAVIO A' },
          },
        },
      },
    ]

    await exportVaziosImportacaoWorkbook(rows)

    expect(jsonToSheet).toHaveBeenCalledWith([
      {
        Container: 'ABCD1234567',
        Tipo: '40HC',
        'Tara (kg)': 3800,
        POD: 'SSZ',
        Navio: 'NAVIO A',
        Viagem: '001',
        Manifesto: 'Baplie',
        'Importado em': '01/06/2026',
      },
    ])
    expect(bookAppendSheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'VaziosImportacao')
    expect(writeFile).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^vazios-importacao-\d+\.xlsx$/))
  })
})
