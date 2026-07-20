import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/209_vazios_export_operations.sql'),
  'utf-8',
)

describe('migration 209 — operacao de vazios da escala', () => {
  it('cria as quatro tabelas com RLS', () => {
    for (const t of [
      'vazios_export_operations', 'vazios_export_overtime_depots',
      'vazios_reorg_services', 'vazios_reorg_rates',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${t}`)
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`)
    }
  })

  it('garante unicidade da operacao por (viagem, porto)', () => {
    expect(sql).toContain('UNIQUE (voyage_id, embark_port)')
  })

  it('restringe servicos aos tres tipos com tarifa configuravel', () => {
    expect(sql).toMatch(/service IN \('bundle', 'desova', 'visual_check'\)/)
    expect(sql).toContain('rate_brl')
  })
})
