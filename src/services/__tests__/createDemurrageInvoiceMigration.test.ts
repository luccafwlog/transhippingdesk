import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/132_create_demurrage_invoice_atomic.sql',
)

it('creates Demurrage invoice header and items in one protected RPC', () => {
  expect(existsSync(migrationPath)).toBe(true)
  const sql = readFileSync(migrationPath, 'utf8')

  expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.create_demurrage_invoice_with_items\b/)
  expect(sql).toMatch(/INSERT INTO public\.demurrage_invoices\b/)
  expect(sql).toMatch(/INSERT INTO public\.demurrage_invoice_items\b/)
  expect(sql).toMatch(/NOT public\.is_admin\(\)/)
  expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.create_demurrage_invoice_with_items[\s\S]+FROM PUBLIC, anon/)
})
