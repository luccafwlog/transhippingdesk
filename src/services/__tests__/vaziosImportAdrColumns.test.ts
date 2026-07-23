import { beforeEach, describe, expect, it, vi } from 'vitest'
import { utils, write } from '@e965/xlsx'
import { importVaziosManifest, parseVaziosManifestBuffer } from '../vaziosImport'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('../supabase', () => ({ supabase: { rpc: rpcMock } }))

beforeEach(() => {
  rpcMock.mockReset()
})

function sheetBuffer(rows: unknown[][]): ArrayBuffer {
  const wb = utils.book_new()
  utils.book_append_sheet(wb, utils.aoa_to_sheet(rows))
  return write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('parser de vazios — colunas do ADR', () => {
  it('mapeia colunas da planilha real e datas seriais', async () => {
    const parsed = await parseVaziosManifestBuffer(sheetBuffer([
      ['CONTAINER', 'POD', 'Current Status', 'HIGHLIGHTS', 'VISUAL CHECK', 'IMPORT EMPTY RETURN DATE', 'EMPTY GATE OUT', 'LOAD DATE', 'ORDER No.', 'OT Handling %', 'OT Transporte %'],
      ['ABCD1234567', 'BRSSZ', 'EMPTY w/ MATERIAL', 'ok', 'yes', 46204, 46208, 46200, 'OS-1', '12.5%', 20],
    ]))
    const row = parsed.bookings[0]
    expect(row.condition).toBe('material')
    expect(row.visual_check).toBe(true)
    expect(row.os_number).toBe('OS-1')
    expect(row.overtime_handling_pct).toBe(12.5)
    expect(row.overtime_transport_pct).toBe(20)
    expect(row.hand_in_date).toBe('2026-07-01')
  })

  it('mapeia porto, depot, flags e datas de hand-in/hand-out', async () => {
    const buffer = sheetBuffer([
      ['Booking', 'Container', 'Tipo', 'Porto Embarque', 'Depot', 'Material', 'Bundle', 'Transporte', 'Hand-in', 'Hand-out', 'OT Handling', 'OT Transporte'],
      ['BK1', 'ABCD1234567', '40HC', 'BRSSA', 'VBR', 'sim', '', 'sim', '01/07/2026', '05/07/2026', 'sim', ''],
    ])
    const parsed = await parseVaziosManifestBuffer(buffer)
    expect(parsed.bookings).toHaveLength(1)
    const b = parsed.bookings[0]
    expect(b.embark_port).toBe('BRSSA')
    expect(b.depot).toBe('VBR')
    expect(b.material).toBe(true)
    expect(b.bundle).toBe(false)
    expect(b.transporte).toBe(true)
    expect(b.hand_in_date).toBe('2026-07-01')
    expect(b.hand_out_date).toBe('2026-07-05')
    expect(b.overtime_handling).toBe(true)
    expect(b.overtime_transport).toBe(false)
  })

  it('planilha antiga (sem colunas novas) continua importando', async () => {
    const buffer = sheetBuffer([
      ['Booking', 'Container', 'Tipo'],
      ['BK2', 'ABCD1234568', '20GP'],
    ])
    const parsed = await parseVaziosManifestBuffer(buffer)
    expect(parsed.bookings[0].embark_port).toBeNull()
    expect(parsed.bookings[0].material).toBe(false)
  })

  it('repassa as colunas do ADR para a RPC transacional', async () => {
    const manifest = await parseVaziosManifestBuffer(sheetBuffer([
      ['Booking', 'Container', 'Tipo', 'Porto Embarque', 'Depot', 'Material', 'Bundle', 'Transporte', 'Hand-in', 'Hand-out', 'OT Handling', 'OT Transporte'],
      ['BK3', 'ABCD1234569', '40HC', 'BRSSA', 'VBR', 'sim', 'x', '1', '01/07/2026', '05/07/2026', 'yes', 'true'],
    ]))
    rpcMock.mockResolvedValue({ data: { manifest_id: 'manifest-1' }, error: null })

    await importVaziosManifest({
      filename: 'vazios.xlsx',
      voyageId: 7,
      port: 'BRSSA',
      manifest,
      uploadedBy: 'user-1',
    })

    expect(rpcMock).toHaveBeenCalledWith('import_vazios_bookings_transactional', expect.objectContaining({
      p_bookings: [expect.objectContaining({
        embark_port: 'BRSSA',
        depot: 'VBR',
        material: true,
        bundle: true,
        transporte: true,
        hand_in_date: '2026-07-01',
        hand_out_date: '2026-07-05',
        overtime_handling: true,
        overtime_transport: true,
      })],
    }))
  })
})
