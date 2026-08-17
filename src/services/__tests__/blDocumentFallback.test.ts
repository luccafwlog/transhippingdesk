import { describe, expect, it, vi } from 'vitest'

const { mockExtractPdfPages } = vi.hoisted(() => ({
  mockExtractPdfPages: vi.fn(),
}))

vi.mock('../blDocumentPdf', () => ({
  extractPdfPages: mockExtractPdfPages,
}))

import { parseBlDocumentBuffer } from '../blDocumentParser'

describe('parseBlDocumentBuffer — PDF sem rótulos', () => {
  it('usa a leitura por conteúdo quando nenhum rótulo do formulário aparece', async () => {
    mockExtractPdfPages.mockResolvedValue([
      {
        number: 1,
        width: 600,
        height: 800,
        runs: [
          { page: 1, x: 10, y: 10, width: 120, height: 10, text: 'SHIPPER LOGISTICS LTD' },
          { page: 1, x: 10, y: 30, width: 120, height: 10, text: 'CONSIGNEE TRADING S.A' },
          { page: 1, x: 10, y: 46, width: 180, height: 10, text: 'CNPJ: 12.116.971/0010-71' },
          { page: 1, x: 10, y: 70, width: 150, height: 10, text: 'NOTIFY IMPORTACAO LTDA' },
          { page: 1, x: 10, y: 90, width: 180, height: 10, text: 'DA XIN V.75 CNTAC' },
          { page: 1, x: 10, y: 110, width: 200, height: 10, text: 'VITORIA,BRAZIL     THREE' },
          { page: 1, x: 10, y: 130, width: 160, height: 10, text: '5 CASES' },
          { page: 1, x: 10, y: 146, width: 160, height: 10, text: 'STEEL PIPES' },
          { page: 1, x: 10, y: 170, width: 200, height: 10, text: '11652 KGS 5.39 CBM' },
          { page: 1, x: 10, y: 190, width: 120, height: 10, text: 'ABC123456789' },
        ],
      },
    ])

    const document = await parseBlDocumentBuffer(new ArrayBuffer(0), 'pdf')

    expect(document.layout).toBe('form')
    expect(document.bl_id).toBe('ABC123456789')
    expect(document.voyage_number).toBe('75')
    expect(document.packages_qty).toBe(5)
    expect(document.gross_weight_kg).toBe(11652)
    expect(document.total_cbm).toBe(5.39)
  })
})
