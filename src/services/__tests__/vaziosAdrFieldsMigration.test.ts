import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../../supabase/migrations/208_vazios_adr_container_fields.sql'),
  'utf-8',
)

describe('migration 208 — campos ADR por container', () => {
  it('adiciona os campos novos de vazios_bookings', () => {
    for (const col of [
      'embark_port', 'depot', 'material', 'bundle', 'transporte',
      'hand_in_date', 'hand_out_date', 'overtime_handling', 'overtime_transport',
    ]) {
      expect(sql).toContain(col)
    }
  })

  it('restringe natureza de vazios descarregados a cama/cover_plate', () => {
    expect(sql).toMatch(/natureza IN \('cama', 'cover_plate'\)/)
  })

  it('reescreve a RPC de import repassando os campos novos', () => {
    expect(sql).toContain('import_vazios_bookings_transactional')
    expect(sql).toMatch(/INSERT INTO public\.vazios_bookings[\s\S]*overtime_transport/)
  })
})
