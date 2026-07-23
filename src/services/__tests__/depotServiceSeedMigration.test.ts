import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/233_depot_service_seed.sql'), 'utf8')

describe('seed de servicos de Depot a partir de tarifas de reorganizacao', () => {
  it('dedupe a tarifa de reorganizacao por servico antes do cross join, evitando violar a unicidade (depot, servico)', () => {
    expect(sql).toContain('DISTINCT ON (service)')
    expect(sql).toContain('depot_id, name, charge_basis, rate_brl, active, valid_from, valid_to')
  })
})
