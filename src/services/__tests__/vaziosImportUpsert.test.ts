import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/232_import_vazios_upsert.sql'), 'utf8')

describe('RPC de importacao por container', () => {
  it('declara todos os campos e faz upsert pela identidade operacional', () => {
    expect(sql).toContain('ON CONFLICT (voyage_id, container_number) DO UPDATE')
    expect(sql).toContain('jsonb_to_recordset')
    expect(sql).toContain('overtime_handling_pct')
    expect(sql).toContain('resolved_depot_id')
    expect(sql).toContain('vazios_manifests')
  })

  it('dedupe container repetido no mesmo lote antes do upsert', () => {
    expect(sql).toContain('DISTINCT ON (container_number)')
    expect(sql).toContain('WITH ORDINALITY')
  })
})
