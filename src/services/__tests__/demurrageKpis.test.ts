import { describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { parsePixExtract } from '../demurrage/demurrageKpis'

function pixWorkbook(rows: unknown[][]): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'PIX')
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
}

describe('parsePixExtract', () => {
  it('normaliza data PIX valida no formato dd/mm/aaaa', async () => {
    const rows = [
      ['Relatorio'],
      ['identificador', 'CPF/CNPJ', 'pago em', 'valor pago'],
      ['INV-001', '12.345.678/0001-95', '05/06/2026', '1.234,56'],
    ]

    await expect(parsePixExtract(pixWorkbook(rows))).resolves.toEqual([
      {
        txid: 'INV-001',
        cnpj: '12.345.678/0001-95',
        date: '2026-06-05',
        amount: 1234.56,
        lineNumber: 3,
      },
    ])
  })

  it('mantem data vazia quando a planilha traz uma data impossivel', async () => {
    const rows = [
      ['identificador', 'CPF/CNPJ', 'pago em', 'valor pago'],
      ['INV-002', '12.345.678/0001-95', '31/02/2026', '100,00'],
    ]

    const parsed = await parsePixExtract(pixWorkbook(rows))

    expect(parsed).toEqual([
      {
        txid: 'INV-002',
        cnpj: '12.345.678/0001-95',
        date: '',
        amount: 100,
        lineNumber: 2,
        },
      ])
    })

  it('normaliza data PIX com componente de horario', async () => {
    const rows = [
      ['identificador', 'CPF/CNPJ', 'pago em', 'valor pago'],
      ['INV-003', '12.345.678/0001-95', '05/06/2026 15:30:45', '100,00'],
    ]

    const parsed = await parsePixExtract(pixWorkbook(rows))

    expect(parsed).toEqual([
      {
        txid: 'INV-003',
        cnpj: '12.345.678/0001-95',
        date: '2026-06-05',
        amount: 100,
        lineNumber: 2,
      },
    ])
  })

  it('preserva linha paga sem TXID para persistencia da pendencia', async () => {
    const rows = [
      ['identificador', 'CPF/CNPJ', 'pago em', 'valor pago'],
      ['', '12.345.678/0001-95', '05/06/2026', '100,00'],
    ]

    await expect(parsePixExtract(pixWorkbook(rows))).resolves.toEqual([
      {
        txid: '',
        cnpj: '12.345.678/0001-95',
        date: '2026-06-05',
        amount: 100,
        lineNumber: 2,
      },
    ])
  })
})
