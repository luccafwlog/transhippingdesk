import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computeStorageTotals,
  listActiveReorgRates,
  listVaziosBookingsForOperation,
} from '../vaziosExportOperations'

const { listVaziosBookingsMock, supabaseFromMock } = vi.hoisted(() => ({
  listVaziosBookingsMock: vi.fn(),
  supabaseFromMock: vi.fn(),
}))

vi.mock('../vaziosImport', () => ({
  listVaziosBookings: listVaziosBookingsMock,
}))
vi.mock('../supabase', () => ({ supabase: { from: supabaseFromMock } }))

beforeEach(() => {
  listVaziosBookingsMock.mockReset()
  supabaseFromMock.mockReset()
})

describe('computeStorageTotals', () => {
  it('soma containers e dias derivados de hand-in/hand-out', () => {
    const totals = computeStorageTotals([
      { hand_in_date: '2026-07-01', hand_out_date: '2026-07-05' },
      { hand_in_date: '2026-07-02', hand_out_date: '2026-07-02' },
      { hand_in_date: null, hand_out_date: null },
    ])

    expect(totals).toEqual({ containers: 2, days: 4 })
  })

  it('ignora pares de datas inválidos ou em ordem negativa', () => {
    const totals = computeStorageTotals([
      { hand_in_date: 'data inválida', hand_out_date: '2026-07-05' },
      { hand_in_date: '2026-07-05', hand_out_date: 'data inválida' },
      { hand_in_date: '2026-07-05', hand_out_date: '2026-07-01' },
      { hand_in_date: '2026-07-01', hand_out_date: '2026-07-03' },
    ])

    expect(totals).toEqual({ containers: 1, days: 2 })
  })
})

describe('listActiveReorgRates', () => {
  it('ordena tarifas sobrepostas por vigência, criação e ID para preservar a precedência', async () => {
    const orderMock = vi.fn()
    const orderChain = { order: orderMock }
    orderMock.mockReturnValue(orderChain)
    const eqMock = vi.fn(() => orderChain)
    const selectMock = vi.fn(() => ({ eq: eqMock }))
    supabaseFromMock.mockReturnValue({ select: selectMock })

    await listActiveReorgRates()

    expect(supabaseFromMock).toHaveBeenCalledWith('vazios_reorg_rates')
    expect(eqMock).toHaveBeenCalledWith('active', true)
    expect(orderMock).toHaveBeenNthCalledWith(1, 'valid_from', { ascending: false })
    expect(orderMock).toHaveBeenNthCalledWith(2, 'created_at', { ascending: false })
    expect(orderMock).toHaveBeenNthCalledWith(3, 'id', { ascending: false })
  })
})

describe('listVaziosBookingsForOperation', () => {
  it('pagina todos os bookings da viagem para montar portos, depots e tipos', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({ id: `booking-${index}` }))
    listVaziosBookingsMock
      .mockResolvedValueOnce({ rows: firstPage, count: 1001 })
      .mockResolvedValueOnce({ rows: [{ id: 'booking-1000' }], count: 1001 })

    const result = await listVaziosBookingsForOperation('7')

    expect(result.rows).toHaveLength(1001)
    expect(listVaziosBookingsMock).toHaveBeenNthCalledWith(1, {
      voyageId: '7',
      page: 1,
      pageSize: 1000,
    })
    expect(listVaziosBookingsMock).toHaveBeenNthCalledWith(2, {
      voyageId: '7',
      page: 2,
      pageSize: 1000,
    })
  })
})
