import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('portal invoice history links migration', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/105_portal_invoice_history_links.sql'),
    'utf8',
  )

  it('uses all invoice receivable links for portal invoice metadata and details', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_list_invoices\(\)/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.portal_invoice_details\(p_invoice_id bigint\)/)
    expect(sql).toContain('FROM public.invoice_receivable_links AS irl')
    expect(sql).toContain('WHERE irl.invoice_id = p_invoice_id')
    expect(sql).not.toMatch(
      /SELECT irl\.bl_id FROM public\.invoice_receivable_links AS irl\s+WHERE irl\.invoice_id = p_invoice_id\s+AND irl\.status = 'active'/,
    )
  })

  it('keeps active-link filtering only for open balance calculation', () => {
    expect(sql).toContain("AND irl.status = 'active'")
    expect(sql).toContain('THEN ledger.balance_brl')
  })
})
