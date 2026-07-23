import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importVaziosManifest, parseVaziosManifestBuffer } from '../vaziosImport'

const rpcMock = vi.fn()
vi.mock('../supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpcMock(...args) } }))
const makeBuffer = async (rows: Record<string, unknown>[]) => {
  const XLSX = await import('@e965/xlsx')
  const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('parser de vazios — novo contrato', () => {
  beforeEach(() => rpcMock.mockReset())
  it('lê overtime único e preserva campos operacionais', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([{ Container: 'ABCD1234567', Depot: 'VBR', Overtime: '12,5%', 'Current Status': 'material', 'Hand-in': '01/07/2026', 'Hand-out': '05/07/2026' }]))
    expect(parsed.bookings[0]).toMatchObject({ depot: 'VBR', overtime_pct: 12.5, condition: 'material', hand_in_date: '2026-07-01', hand_out_date: '2026-07-05' })
  })
  it('persiste overtime_pct na RPC', async () => {
    rpcMock.mockResolvedValue({ data: { manifest_id: 'm1' }, error: null })
    await importVaziosManifest({ filename: 'x.xlsx', voyageId: 7, port: 'BRSSA', uploadedBy: 'user-1', manifest: { bookings: [{ rowNumber: 2, booking_number: null, container_number: 'ABCD1234569', container_type: null, movement_date: null, origin_terminal: null, destination: null, notes: null, embark_port: 'BRSSA', depot: 'VBR', material: true, condition: 'material', hand_in_date: null, hand_out_date: null, os_number: null, overtime_pct: 15 }], rowErrors: [] } })
    expect(rpcMock).toHaveBeenCalledWith('import_vazios_bookings_transactional', expect.objectContaining({ p_bookings: [expect.objectContaining({ overtime_pct: 15 })] }))
  })
})
