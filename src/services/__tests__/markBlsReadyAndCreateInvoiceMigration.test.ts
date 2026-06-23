import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260622133100_mark_bls_ready_and_create_invoice_atomic.sql',
)

it('promotes and invoices a customer B/L group in one database transaction', () => {
  expect(existsSync(migrationPath)).toBe(true)
  const sql = readFileSync(migrationPath, 'utf8')

  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.mark_bls_ready_and_create_invoice\b/)
  expect(sql).toMatch(/PERFORM public\.mark_bl_ready_for_billing/)
  expect(sql).toMatch(/RETURN public\.create_invoice_from_bls_with_ledger/)
  expect(sql).toMatch(/FOR UPDATE/)
  expect(sql).toMatch(/NOT public\.is_admin\(\)/)
})
