import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/243_rejeita_duplicata_vazios.sql'), 'utf8')

describe('RPC de importacao por substituicao total', () => {
  it('apaga a lista anterior e insere a nova dentro da mesma RPC', () => {
    expect(sql).toContain('DELETE FROM public.vazios_bookings')
    expect(sql).toContain('INSERT INTO public.vazios_bookings')
    expect(sql).toContain('RETURNS JSONB')
    expect(sql).toContain('jsonb_to_recordset')
    expect(sql).toContain('local_id')
    expect(sql).toContain('vazios_manifests')
  })

  it('rejeita container repetido no mesmo lote antes de substituir a lista', () => {
    expect(sql).toContain('Container duplicado na planilha')
    expect(sql).not.toContain('deduped AS')
  })
})
