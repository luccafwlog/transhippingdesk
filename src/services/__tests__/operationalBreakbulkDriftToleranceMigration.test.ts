import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/040_operational_breakbulk_drift_tolerance.sql'),
  'utf8',
)

describe('migration 040 — tolerância operacional do resumo BB', () => {
  it('mantém o contrato invoker e a normalização segura dos agrupamentos', () => {
    expect(migrationSql).toMatch(/CREATE OR REPLACE FUNCTION\s+public\.operational_list_bl_summary/i)
    expect(migrationSql).toMatch(/LOWER\(BTRIM\(COALESCE\(charge_status, ''\)\)\)/i)
    expect(migrationSql).toMatch(/SECURITY INVOKER/i)
    expect(migrationSql).toMatch(/GRANT EXECUTE\s+ON FUNCTION\s+public\.operational_list_bl_summary/i)
  })
})
