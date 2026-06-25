import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ledger backfill exception report migration', () => {
  it('returns explicit exception and total mismatch details from backfill RPCs', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/072_ledger_backfill_exception_report.sql'),
      'utf8',
    )

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.backfill_local_charge_receivables\b/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.backfill_invoice_receivable_links\b/)
    expect(sql).toContain("'exceptions'")
    expect(sql).toContain("'total_mismatches'")
    expect(sql).toContain("'missing_receivables'")
    expect(sql).toContain('jsonb_build_array')
  })
})
