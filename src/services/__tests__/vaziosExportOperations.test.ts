import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computeStorageTotals,
  listVaziosBookingsForOperation,
} from '../vaziosExportOperations'

const { listVaziosBookingsMock } = vi.hoisted(() => ({
  listVaziosBookingsMock: vi.fn(),
}))

vi.mock('../vaziosImport', () => ({
  listVaziosBookings: listVaziosBookingsMock,
}))
vi.mock('../supabase', () => ({ supabase: {} }))

beforeEach(() => {
  listVaziosBookingsMock.mockReset()
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
