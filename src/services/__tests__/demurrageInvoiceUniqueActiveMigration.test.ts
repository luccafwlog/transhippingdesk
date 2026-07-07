import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/169_demurrage_invoice_unique_active.sql',
)

describe('Demurrage active invoice uniqueness migration', () => {
  it('guards existing duplicates before creating the partial unique index', () => {
    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toMatch(/HAVING COUNT\(\*\) > 1/)
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_demurrage_invoices_active_bl/)
    expect(sql).toMatch(/WHERE status IN \('issued', 'paid'\)/)
  })

  it('redefines the RPC with an active-invoice check and preserved security clauses', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.create_demurrage_invoice_with_items\b/)
    expect(sql).toMatch(/SECURITY DEFINER/)
    expect(sql).toMatch(/SET search_path = public, pg_temp/)
    expect(sql).toMatch(/IF EXISTS \([\s\S]+public\.demurrage_invoices[\s\S]+di\.bl_id = p_bl_id[\s\S]+di\.status IN \('issued', 'paid'\)[\s\S]+ERRCODE = '23505'/)
  })
})
