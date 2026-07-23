import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/229_depot_cadastro_tarifas.sql'), 'utf8')

describe('migration de Cadastro de Depot', () => {
  it('cria depot, tarifas e servicos com vigencia e indices', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.depots')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.depot_tariffs')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.depot_services')
    expect(migration).toContain('idx_depot_tariffs_depot')
    expect(migration).toContain('idx_depot_services_depot')
    expect(migration).toContain('valid_to IS NULL OR valid_to >= valid_from')
    expect(migration).toContain("charge_basis IN ('per_container_flag', 'per_operation_qty')")
  })
})
