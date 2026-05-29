import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ledger consolidated reissue migration', () => {
  it('marks obsolete consolidated invoices as replaced when a new consolidated links the same receivable', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260529150000_ledger_consolidated_reissue_links.sql'),
      'utf8',
    )

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.mark_replaced_obsolete_consolidated_invoice\b/)
    expect(sql).toContain("v_new_invoice.invoice_type = 'consolidated'")
    expect(sql).toContain("old_inv.status = 'obsolete'")
    expect(sql).toContain('old_inv.replaced_by_invoice_id IS NULL')
    expect(sql).toContain('old_link.receivable_id = NEW.receivable_id')
    expect(sql).toContain('SET replaced_by_invoice_id = NEW.invoice_id')
    expect(sql).toMatch(/CREATE TRIGGER trg_mark_replaced_obsolete_consolidated_invoice\s+AFTER INSERT ON public\.invoice_receivable_links/)
  })
})
