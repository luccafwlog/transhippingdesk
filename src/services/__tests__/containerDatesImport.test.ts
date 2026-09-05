import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importContainerDates, parseContainerDatesFile } from '../containerDatesImport'
import { jsonToBuffer } from './testWorkbook'

type FakeContainer = {
  id: number
  bl_id: string
  container_number: string
  container_type: string | null
  discharge_date: string | null
  return_date: string | null
  demurrage_status: string | null
}

const { mockFrom, mockUpdateEq, mockCreateInvoiceForReturnedBL, mockEnsureRates, state } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockUpdateEq: vi.fn(),
  mockCreateInvoiceForReturnedBL: vi.fn(),
  mockEnsureRates: vi.fn(),
  state: { containers: [] as unknown[] },
}))

function setContainers(rows: FakeContainer[]) {
  state.containers = rows
}

// Cada `from(...)` do import devolve so o encadeamento que aquela tabela usa.
mockFrom.mockImplementation((table: string) => {
  if (table === 'bl_containers') {
    return {
      select: () => ({ in: () => Promise.resolve({ data: state.containers, error: null }) }),
      update: () => ({ eq: mockUpdateEq }),
    }
  }
  if (table === 'bls') {
    return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }
  }
  return {
    select: () => ({ in: () => ({ eq: () => ({ order: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) }),
  }
})

vi.mock('../supabase', () => ({ supabase: { from: mockFrom } }))
vi.mock('../demurrage/demurrageInvoices', () => ({ createInvoiceForReturnedBL: mockCreateInvoiceForReturnedBL }))
vi.mock('../demurrage/demurrageRates', () => ({
  ensureDemurrageRatesLoaded: mockEnsureRates,
  calculateDemurrage: () => ({ totalUsd: 0 }),
}))

describe('containerDatesImport', () => {
  it('aceita linha com devolucao opcional em branco', async () => {
    const buffer = jsonToBuffer([{ BL: 'BL001', Container: 'TCLU1234567', Descarga: '2026-01-10', Devolucao: '' }])
    const parsed = await parseContainerDatesFile(new File([buffer], 'datas-container.xlsx'))

    expect(parsed.rowErrors).toHaveLength(0)
    expect(parsed.rows).toEqual([{
      bl_id: 'BL001',
      container_number: 'TCLU1234567',
      discharge_date: '2026-01-10',
      return_date: null,
    }])
  })

  it('rejeita devolucao anterior a descarga', async () => {
    const buffer = jsonToBuffer([
      {
        BL: 'BL001',
        Container: 'TCLU1234567',
        Descarga: '2026-01-10',
        Devolucao: '2026-01-09',
      },
    ])
    const file = new File([buffer], 'datas-container.xlsx')

    const parsed = await parseContainerDatesFile(file)

    expect(parsed.rows).toHaveLength(0)
    expect(parsed.rowErrors).toHaveLength(1)
    expect(parsed.rowErrors[0]?.message).toContain('Data de devolucao anterior a descarga')
  })

  it('rejeita linha sem descarga', async () => {
    const buffer = jsonToBuffer([{ BL: 'BL001', Container: 'TCLU1234567', Descarga: '', Devolucao: '' }])
    const parsed = await parseContainerDatesFile(new File([buffer], 'datas-container.xlsx'))

    expect(parsed.rows).toHaveLength(0)
    expect(parsed.rowErrors[0]?.message).toContain('Data de descarga invalida ou ausente')
  })
})

// Regressao do lote parcial: cada linha e uma transacao propria. Antes, a
// primeira falha de gravacao lancava e abortava o import, deixando as linhas
// ja gravadas sem passar pelo faturamento de Demurrage — e o reimport do mesmo
// arquivo as classificava como "inalteradas", de modo que a fatura nunca nascia.
describe('importContainerDates (lote parcial)', () => {
  beforeEach(() => {
    mockUpdateEq.mockReset()
    mockCreateInvoiceForReturnedBL.mockReset()
    mockCreateInvoiceForReturnedBL.mockResolvedValue(null)
  })

  it('nao aborta o lote quando uma linha falha ao gravar', async () => {
    setContainers([
      { id: 1, bl_id: 'BL001', container_number: 'TCLU1111111', container_type: 'DRY', discharge_date: null, return_date: null, demurrage_status: null },
      { id: 2, bl_id: 'BL001', container_number: 'TCLU2222222', container_type: 'DRY', discharge_date: null, return_date: null, demurrage_status: null },
    ])
    mockUpdateEq
      .mockResolvedValueOnce({ error: { message: 'conflito de escrita' } })
      .mockResolvedValueOnce({ error: null })

    const result = await importContainerDates([
      { bl_id: 'BL001', container_number: 'TCLU1111111', discharge_date: '2026-01-10', return_date: '2026-01-20' },
      { bl_id: 'BL001', container_number: 'TCLU2222222', discharge_date: '2026-01-10', return_date: '2026-01-20' },
    ])

    expect(result.updated).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.container_number).toBe('TCLU1111111')
    expect(result.errors[0]?.message).toContain('conflito de escrita')
  })

  it('refatura B/L cuja devolucao ja estava gravada por uma tentativa interrompida', async () => {
    setContainers([
      { id: 1, bl_id: 'BL001', container_number: 'TCLU1111111', container_type: 'DRY', discharge_date: '2026-01-10', return_date: '2026-01-20', demurrage_status: 'returned' },
    ])

    const result = await importContainerDates([
      { bl_id: 'BL001', container_number: 'TCLU1111111', discharge_date: '2026-01-10', return_date: '2026-01-20' },
    ])

    expect(result.unchanged).toBe(1)
    expect(result.updated).toBe(0)
    expect(mockCreateInvoiceForReturnedBL).toHaveBeenCalledWith('BL001')
  })
})
