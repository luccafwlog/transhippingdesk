import { describe, expect, it, vi } from 'vitest'

const { mockExtractPdfPages } = vi.hoisted(() => ({
  mockExtractPdfPages: vi.fn(),
}))

vi.mock('../blDocumentPdf', () => ({
  extractPdfPages: mockExtractPdfPages,
}))

import { parseBlDocumentBuffer } from '../blDocumentParser'

// Geometria real do B/L de carga solta GP12ZJGVIT31 (COSCO especializado):
// o rótulo do POD sai em dois comandos de texto, "6" e ".Port of Discharge:",
// e o "6" é gravado 0,0002pt abaixo do resto da linha. Isso basta para os dois
// trechos chegarem separados e fora de ordem, e antes da leitura por linha o
// rótulo não era reconhecido — o B/L entrava sem POD.
describe('parseBlDocumentBuffer — rótulo quebrado em vários trechos', () => {
  it('reconhece o POD quando o número do rótulo vem separado e fora de ordem', async () => {
    mockExtractPdfPages.mockResolvedValue([
      {
        number: 1,
        width: 595.32,
        height: 841.92,
        runs: [
          { page: 1, x: 402.5, y: 26.3, width: 56.9, height: 8, text: 'GP12ZJGVIT31' },
          { page: 1, x: 368.8, y: 26.8, width: 27.6, height: 8, text: 'B/L No.' },
          { page: 1, x: 34.4, y: 41.4, width: 147.6, height: 8, text: '1 Shipper (Insert name, address and phone)' },
          { page: 1, x: 38.2, y: 51.5, width: 98.1, height: 8, text: 'SANY SOUTH EAST ASIA PTE LTD' },
          { page: 1, x: 33.5, y: 116.2, width: 156.5, height: 8, text: '2.Consignee (Insert name, address and phone)' },
          { page: 1, x: 38.0, y: 124.0, width: 141.4, height: 8, text: 'TIMBRO TRADING S.A - CNPJ: 12.116.971/0010-71' },
          { page: 1, x: 34.4, y: 262.0, width: 29.6, height: 8, text: '4.Vessel:' },
          { page: 1, x: 280.3, y: 262.2, width: 62.7, height: 8, text: '5.Port of Loading:' },
          { page: 1, x: 70.6, y: 262.3, width: 97.3, height: 8, text: 'GREEN PARANAGUA V12' },
          { page: 1, x: 345.0, y: 263.0, width: 77.0, height: 8, text: 'ZHANGJIAGANG,CN' },
          { page: 1, x: 378.0, y: 276.42, width: 4.5, height: 8, text: '3' },
          { page: 1, x: 38.52, y: 277.0797, width: 64.56, height: 8.5, text: '.Port of Discharge:' },
          { page: 1, x: 280.06, y: 277.0797, width: 92.61, height: 8.5, text: '7.Number of Original Bs/L' },
          { page: 1, x: 34.44, y: 277.0799, width: 4.08, height: 8.2, text: '6' },
          { page: 1, x: 372.72, y: 277.0799, width: 2.26, height: 8.2, text: ':' },
          { page: 1, x: 103.8, y: 277.44, width: 45.44, height: 8, text: 'VITORIA,BR' },
          { page: 1, x: 426.8, y: 293.4, width: 37.2, height: 8, text: 'Gross weight' },
          { page: 1, x: 184.9, y: 309.5, width: 21.6, height: 8, text: '6 PKGS' },
          { page: 1, x: 434.5, y: 322.4, width: 31.0, height: 8, text: '65790 KGS' },
          { page: 1, x: 512.6, y: 322.8, width: 36.7, height: 8, text: '317.016 CBM' },
        ],
      },
    ])

    const document = await parseBlDocumentBuffer(new ArrayBuffer(0), 'pdf')

    expect(document.layout).toBe('labeled')
    expect(document.pod_raw).toBe('VITORIA,BR')
    expect(document.pod).toBe('BRVIX')
    expect(document.pol).toBe('CNZJG')
    expect(document.originals).toBe(3)
    expect(document.warnings.join(' ')).not.toContain('POD')
  })
})
