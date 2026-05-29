import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ledger phase 4d migration', () => {
  it('routes portal balances through bl_receivables', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260529130000_ledger_portal_reports_phase4d.sql'),
      'utf8',
    )

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_get_session_overview\b/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_get_session_overview_v2\b/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_list_pending_bls\b/)
    expect(sql).toContain('public.bl_receivables')
    expect(sql).toContain("WHEN i.invoice_type IN ('individual', 'consolidated') AND ledger.link_count > 0")
    expect(sql).toContain("COALESCE(i.status, 'issued') IN ('issued', 'partially_paid', 'overdue')")
    expect(sql).toContain('active_balance_brl')
    expect(sql).not.toContain('SUM(COALESCE(i.balance_brl')
  })
})
