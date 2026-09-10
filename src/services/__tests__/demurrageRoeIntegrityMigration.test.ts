import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readMigration() {
  const dir = resolve(process.cwd(), 'supabase/migrations')
  const file = readdirSync(dir)
    .filter((name) => name.endsWith('_demurrage_roe_integrity.sql'))
    .sort()
    .at(-1)

  expect(file).toBeTruthy()
  const path = resolve(dir, file!)
  expect(existsSync(path)).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('Demurrage ROE/document integrity migration', () => {
  const sql = readMigration()

  it('persists BRL presentation values on invoice items and keeps the authoritative total', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS subtotal_brl NUMERIC\(14,2\)/i)
    expect(sql).toContain('sync_demurrage_invoice_item_brl')
    expect(sql).toContain('current_total_brl')
    expect(sql).toContain('result_snapshot')
  })

  it('bounds both persisted ROE columns and removes browser writes to their provenance fields', () => {
    expect(sql).toContain('demurrage_invoices_roe_sanity_check')
    expect(sql).toContain('demurrage_invoices_current_roe_sanity_check')
    expect(sql).toContain('demurrage_invoices_roe_source_sanity_check')
    expect(sql).toMatch(/REVOKE\s+UPDATE\s*\(\s*roe\s*,\s*roe_manual\s*\)\s+ON TABLE public\.demurrage_invoices\s+FROM (?:anon,\s*)?authenticated/i)
    expect(sql).toMatch(/roe_source.*manual/i)
  })
})
