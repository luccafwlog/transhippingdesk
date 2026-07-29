import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/238_embarque_vazios_unidades.sql'), 'utf8')

describe('RPC de importacao por substituicao total', () => {
  it('apaga a lista anterior e insere a nova dentro da mesma RPC', () => {
    expect(sql).toContain('DELETE FROM public.vazios_bookings')
    expect(sql).toContain('INSERT INTO public.vazios_bookings')
    expect(sql).toContain('RETURNS JSONB')
    expect(sql).toContain('jsonb_to_recordset')
    expect(sql).toContain('local_id')
    expect(sql).toContain('vazios_manifests')
  })

  it('dedupe container repetido no mesmo lote antes do upsert', () => {
    expect(sql).toContain('DISTINCT ON (upper(btrim(container_number)))')
  })
})
