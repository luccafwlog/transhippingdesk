import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
  it('lê as sete colunas do modelo manual', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([{ Container: 'ABCD1234567', Depot: 'VBR', Condition: 'material', 'Hand-in': '01/07/2026', 'Hand-out': '05/07/2026', 'Load date': '06/07/2026', Type: '40HC' }]))
    expect(parsed.bookings[0]).toMatchObject({ local_code: 'VBR', condition: 'material', container_type: '40HC', hand_in_date: '2026-07-01', hand_out_date: '2026-07-05', movement_date: '2026-07-06' })
  })
  it('aceita cabeçalhos Excel com acentos preservados', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([{ CONTAINER: 'ABCD1234568', TIPO: '40HC', LOCAL: 'VBR', ['CONDI\u00C7\u00C3O']: 'vazio', ENTRADA: '01/07/2026', ['SA\u00CDDA']: '05/07/2026', EMBARQUE: '06/07/2026' }]))
    expect(parsed.rowErrors).toEqual([])
    expect(parsed.bookings[0]).toMatchObject({ local_code: 'VBR', condition: 'vazio', hand_in_date: '2026-07-01', hand_out_date: '2026-07-05', movement_date: '2026-07-06' })
  })
  it('normaliza datas Excel no formato MM/DD/YYYY sem enviar mes invalido ao banco', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([{ CONTAINER: 'ABCD1234570', TIPO: '40HC', LOCAL: 'VBR', Condition: 'vazio', 'Hand-in': '02/25/2026', 'Hand-out': '02/26/2026', 'Load date': '02/27/2026' }]))
    expect(parsed.rowErrors).toEqual([])
    expect(parsed.bookings[0]).toMatchObject({ hand_in_date: '2026-02-25', hand_out_date: '2026-02-26', movement_date: '2026-02-27' })
  })
  it('processa o modelo xlsx publicado pela tela', async () => {
    const buffer = readFileSync(resolve(process.cwd(), 'public/templates/unidades-embarcadas-modelo.xlsx'))
    const parsed = await parseVaziosManifestBuffer(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))
    expect(parsed.rowErrors).toEqual([])
    expect(parsed.bookings[0]).toMatchObject({ container_number: 'ABCD1234567', local_code: 'VBR', condition: 'vazio' })
  })
  it('recusa datas impossÃ­veis antes da persistÃªncia', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([{ Container: 'ABCD1234571', Depot: 'VBR', Condition: 'vazio', 'Hand-in': '31/02/2026' }]))
    expect(parsed.bookings[0].hand_in_date).toBeNull()
    expect(parsed.rowErrors.map((error) => error.message).join(' ')).toContain('data de entrada')
  })
  it('persiste somente as sete colunas na RPC', async () => {
    rpcMock.mockResolvedValue({ data: { manifest_id: 'm1' }, error: null })
    await importVaziosManifest({ filename: 'x.xlsx', voyageId: 7, port: 'BRSSA', uploadedBy: 'user-1', manifest: { bookings: [{ rowNumber: 2, container_number: 'ABCD1234569', container_type: '20DV', local_code: 'VBR', condition: 'vazio', hand_in_date: '2026-07-01', hand_out_date: '2026-07-02', movement_date: '2026-07-03' }], rowErrors: [] } })
    expect(rpcMock).toHaveBeenCalledWith('import_vazios_bookings_transactional', expect.objectContaining({ p_bookings: [expect.objectContaining({ local_code: 'VBR', condition: 'vazio' })] }))
  })
  it('dedupe container repetido na planilha, mantendo a ultima ocorrencia', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([
      { Container: 'ABCD1234567', Depot: 'VBR', Condition: 'vazio' },
      { Container: 'ABCD1234567', Depot: 'VIX', Condition: 'material' },
    ]))
    expect(parsed.bookings).toHaveLength(2)
    expect(parsed.rowErrors).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 3, message: expect.stringContaining('duplicado') }),
    ]))
  })
  it('recusa linha sem condição ou local', async () => {
    const parsed = await parseVaziosManifestBuffer(await makeBuffer([{ Container: 'ABCD1234567' }]))
    expect(parsed.bookings).toHaveLength(1)
    expect(parsed.rowErrors.map((error) => error.message).join(' ')).toContain('condição')
    expect(parsed.rowErrors.map((error) => error.message).join(' ')).toContain('local')
  })
})
