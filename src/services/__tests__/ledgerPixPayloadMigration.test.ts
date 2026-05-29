import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ledger PIX payload migration', () => {
  it('generates PIX payloads in the database for local individual and consolidated invoices', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260529144000_ledger_invoice_pix_payload.sql'),
      'utf8',
    )

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.build_transshipping_pix_payload\b/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.populate_local_invoice_pix_payload\b/)
    expect(sql).toContain("COALESCE(NEW.invoice_type, 'individual') IN ('individual', 'consolidated')")
    expect(sql).toContain('public.build_transshipping_pix_payload(NEW.total_brl, NEW.invoice_number)')
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF invoice_number, total_brl, invoice_type, pix_payload\s+ON public\.invoices/)
  })
})
